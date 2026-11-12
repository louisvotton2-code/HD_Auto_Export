import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { findBrand, VehicleDraftInputSchema, PublicationPreviewSchema, PublishReadinessSchema,
  type ConfirmPublicationPreviewRequest, type PublicationIssue, type PublicationPreviewText,
  type PublicationPreview, type PublishReadiness, type VehicleDraftInput } from '@hd/contracts/admin';
import { PublicPriceSchema, type Availability, type Locale } from '@hd/contracts/public';
import { readFxQuote } from '../external/fx.js';
import { canonicalJson } from '../external/normalize.js';
import { ApiError, conflict } from '../errors.js';
import type { LocalMediaStore } from '../media/storage.js';
import { locales } from './content.js';
import { projectUsdPrice } from './usd-price.js';
import type { StoredLocalization } from './localization.js';

export type PublicationRow = { id: string; stock_number: string; version: number; public_content_revision: number;
  availability: Availability; availability_checked_at: Date | null; data: VehicleDraftInput };
type MediaRow = { id: string; version: number; state: string; width: number | null; height: number | null;
  rights: { basis?: string; source?: { listingUrl?: string } } };
type Confirmation = { public_revision: number; fingerprint: string; locale: Locale; confirmed_at: Date; expires_at: Date };
export type PublicationPreparation = { preview: PublicationPreview; issues: PublicationIssue[]; media: MediaRow[];
  localization: StoredLocalization };

/** Called inside the publishing transaction so disabling staff cannot race authorization. */
export async function requirePublicationActor(tx: PoolClient, actorId: string) {
  const { rows: [staff] } = await tx.query('SELECT role,banned FROM staff WHERE id=$1 FOR SHARE', [actorId]);
  if (!staff || staff.banned) throw new ApiError(401, 'UNAUTHENTICATED', 'Staff session is no longer active.');
  if (staff.role !== 'admin' && staff.role !== 'editor') throw new ApiError(403, 'FORBIDDEN', 'Publication permission is required.');
}

function previewText(field: VehicleDraftInput['content']['title'] | undefined, locale: Locale): PublicationPreviewText {
  const value = field?.translations[locale];
  if (!field || !value) return { text: null, requestedLocale: locale, contentLocale: null,
    kind: null, reviewStatus: 'missing', sourceVersion: null };
  return { text: value.text, requestedLocale: locale, contentLocale: value.kind === 'original' ? field.sourceLanguage : locale,
    kind: value.kind, reviewStatus: value.sourceVersion === field.sourceVersion ? value.reviewStatus : 'stale', sourceVersion: value.sourceVersion };
}

/** Caller holds the vehicle lock. No network/translation calls; original files are checked locally. */
export async function preparePublication(tx: PoolClient, row: PublicationRow, localization: StoredLocalization,
  locale: Locale, store: Pick<LocalMediaStore, 'prepareDelivery'> | undefined): Promise<PublicationPreparation> {
  const draft = row.data, issues: PublicationIssue[] = [];
  const missing = (path: string, message: string, stage: PublicationIssue['stage'] = 'required_fields') =>
    issues.push({ path, message, stage, code: 'REQUIRED_FOR_PUBLICATION' });
  const staffInventory = draft.source.kind !== 'demo';
  const validDraft = VehicleDraftInputSchema.safeParse(draft);
  if (!validDraft.success) for (const issue of validDraft.error.issues)
    missing(`draft.${issue.path.join('.')}`, 'The draft contains invalid fields for its source type.');
  for (const field of ['make', 'model'] as const) if (!draft.facts[field]) missing(`draft.facts.${field}`, `${field} is required.`);
  if (staffInventory) {
    if (!draft.facts.trim) missing('draft.facts.trim', 'Configuration is required.');
    if (draft.facts.modelYear === null) missing('draft.facts.modelYear', 'Model year is required.');
    if (draft.facts.powertrain === 'unknown') missing('draft.facts.powertrain', 'A known powertrain is required.');
    if (draft.facts.mileageKm === null) missing('draft.facts.mileageKm', 'Mileage is required; zero is valid.');
    if (!draft.content.description.sourceText?.trim()) missing('draft.content.description.sourceText', 'Vehicle condition description is required.');
    const expected = draft.source.kind === 'manual' ? 'asking' : 'reference';
    if (draft.price.kind !== expected || draft.price.money?.amount == null || Number(draft.price.money.amount) <= 0)
      missing('draft.price', `A positive ${expected} price and its currency are required.`);
    if (draft.internal.purchaseCost?.amount == null || Number(draft.internal.purchaseCost.amount) <= 0)
      missing('draft.internal.purchaseCost', 'A positive purchase cost and its currency are required.');
  }
  if (draft.source.kind === 'manual') {
    if (!draft.facts.location) missing('draft.facts.location', 'Location country is required.');
    if (row.availability === 'unknown' || !row.availability_checked_at) missing('availability', 'Verify availability before publishing.');
  } else if (row.availability !== 'unknown' || row.availability_checked_at !== null) {
    missing('availability', 'External copies and examples must retain unknown availability.');
  }
  if (!draft.content.title.sourceText?.trim()) missing('draft.content.title.sourceText', 'Original title is required.');
  for (const language of locales) for (const name of ['title', 'description'] as const) {
    const field = draft.content[name], translated = field.translations[language];
    if (!staffInventory && name === 'description' && field.sourceText === null && locales.every(l => !field.translations[l])) continue;
    if (!translated?.text.trim() || translated.sourceVersion !== field.sourceVersion ||
      (staffInventory ? translated.reviewStatus !== 'approved' : translated.reviewStatus === 'stale'))
      missing(`draft.content.${name}.translations.${language}`, 'A reviewed translation of the current source is required.', 'localization');
    if (translated?.kind === 'original' && (language !== field.sourceLanguage.split('-')[0] || translated.text !== field.sourceText))
      missing(`draft.content.${name}.translations.${language}.kind`, 'Original text must match its source and language.', 'localization');
  }
  for (const field of localization.data.fields) for (const language of locales) {
    const value = field.translations[language];
    if (!value || value.sourceVersion !== field.sourceVersion || (staffInventory ? value.reviewStatus !== 'approved' : value.reviewStatus === 'stale'))
      missing(`localization.${field.ref}.${language}`, 'A reviewed display translation of the current source is required.', 'localization');
  }
  if (draft.media.filter(m => m.isCover).length !== 1) missing('draft.media', 'One ready cover is required.');
  const { rows: media } = await tx.query<MediaRow>('SELECT * FROM media_assets WHERE vehicle_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',
    [row.id, draft.media.map(m => m.id)]);
  const ready = new Set<string>();
  for (const image of draft.media) {
    const stored = media.find(m => m.id === image.id.toLowerCase());
    let readable = false;
    if (stored?.state === 'ready' && stored.width && stored.height && store) {
      try { await store.prepareDelivery(image.id); readable = true; } catch { /* Missing files remain an explicit publication gate. */ }
    }
    if (readable) ready.add(image.id);
    else missing(`draft.media.${image.id}`, 'Every referenced image must be processed, readable and owned by this vehicle.');
    if (draft.source.kind === 'external') {
      if (!stored?.rights.source || stored.rights.source.listingUrl !== draft.source.listingUrl)
        missing(`draft.media.${image.id}.rights`, 'External photos require provenance for this same listing.');
    } else if (!stored?.rights || stored.rights.basis === 'unverified') {
      missing(`draft.media.${image.id}.rights`, 'Declared image ownership or permission is required.');
    }
  }
  const byRef = new Map(localization.data.fields.map(f => [f.ref, f]));
  const get = (ref: string) => previewText(byRef.get(ref), locale);
  const brand = findBrand(draft.facts.make);
  const make: PublicationPreviewText = brand ? { text: brand.labels[locale], requestedLocale: locale,
    contentLocale: locale, kind: 'catalog', reviewStatus: 'approved', sourceVersion: 1 } : get('make');
  const display = { make, model: get('model'), trim: get('trim'), generation: get('generation'),
    city: get('location.city'), location: get('location.displayName'), platform: get('source.platform'),
    priceIncludes: localization.data.fields.filter(f => f.ref.startsWith('price.includes.')).map(f => ({ id: f.ref.slice(15), value: get(f.ref) })),
    mediaAlt: draft.media.map(m => ({ mediaId: m.id, value: get(`media.${m.id.toLowerCase()}.alt`) })) };
  // Coordinate with the existing FX writer; a new rate cannot slip between confirmation validation and commit.
  await tx.query('SELECT pg_advisory_xact_lock_shared(86147,9)');
  const quote = await readFxQuote(tx, 'wall');
  const complete = PublicPriceSchema.safeParse(draft.price);
  const displayPrice = complete.success ? projectUsdPrice(complete.data, quote) : null;
  const price = { ...draft.price, includes: display.priceIncludes.flatMap(item => item.value.text ? [item.value.text] : []),
    status: draft.price.kind === 'on_request' ? 'on_request' : complete.success ? 'ready' : 'missing', displayPrice };
  const placeholder = { zh: '待翻译', en: 'Awaiting translation', ru: 'Ожидает перевода' }[locale];
  const named = (value: { id: string; name: string } | null, text: PublicationPreviewText) =>
    value ? { id: value.id, name: text.text ?? placeholder } : null;
  const vehicle = { id: row.id, stockCode: `HD-${String(row.stock_number).padStart(6, '0')}`,
    source: draft.source.kind === 'external' ? { kind: 'external',
      platform: { id: draft.source.platform.id, name: display.platform.text ?? placeholder }, listingUrl: draft.source.listingUrl } : { kind: draft.source.kind },
    facts: { ...draft.facts, make: named(draft.facts.make, display.make), model: named(draft.facts.model, display.model),
      trim: named(draft.facts.trim, display.trim), generation: named(localization.data.facts.generation, display.generation),
      drivetrain: localization.data.facts.drivetrain,
      location: draft.facts.location ? { country: draft.facts.location.country, city: display.city.text, displayName: display.location.text } : null },
    content: { title: previewText(draft.content.title, locale), description: previewText(draft.content.description, locale) }, display, price,
    images: [...draft.media].sort((a, b) => a.sortOrder - b.sortOrder).map(image => {
      const stored = media.find(m => m.id === image.id.toLowerCase());
      return { ...image, alt: get(`media.${image.id.toLowerCase()}.alt`).text ?? '',
        url: ready.has(image.id) ? `/api/v1/admin/media/${image.id}/preview` : null,
        width: stored?.width ?? null, height: stored?.height ?? null, status: ready.has(image.id) ? 'ready' : 'missing' };
    }), availability: row.availability, availabilityCheckedAt: row.availability_checked_at?.toISOString() ?? null };
  const publicData = { source: draft.source, facts: draft.facts, price: draft.price, content: draft.content, media: draft.media };
  const fingerprint = createHash('sha256').update(canonicalJson({ publicContentRevision: row.public_content_revision,
    locale, vehicle, publicData, localization: localization.data,
    media: media.map(m => ({ id: m.id, version: m.version, state: m.state, rights: m.rights })),
    // Only relevant conversion changes invalidate a native USD / missing / on-request preview.
    fx: complete.success && complete.data.money && complete.data.money.currency !== 'USD' ? quote : null })).digest('hex');
  const preview = PublicationPreviewSchema.parse({ schemaVersion: 1, vehicleVersion: row.version,
    publicContentRevision: row.public_content_revision, fingerprint, locale, priceView: 'usd', vehicle });
  return { preview, issues, media, localization };
}

export async function currentConfirmation(tx: PoolClient, vehicleId: string, actorId: string) {
  return (await tx.query<Confirmation>('SELECT * FROM publication_preview_confirmations WHERE vehicle_id=$1 AND actor_id=$2 AND expires_at>clock_timestamp()', [vehicleId, actorId])).rows[0];
}

export function publicationReadiness(prepared: PublicationPreparation, confirmation?: Confirmation): PublishReadiness {
  const { preview } = prepared;
  const confirmed = !!confirmation && confirmation.public_revision === preview.publicContentRevision &&
    confirmation.fingerprint === preview.fingerprint && confirmation.locale === preview.locale;
  const issues = [...prepared.issues];
  if (!confirmed) issues.push({ stage: 'preview', path: 'publicationPreview', code: 'PREVIEW_CONFIRMATION_REQUIRED',
    message: 'Confirm the current publication preview before publishing.' });
  const requiredFieldsReady = !issues.some(issue => issue.stage === 'required_fields');
  const localizationReady = !issues.some(issue => issue.stage === 'localization');
  return PublishReadinessSchema.parse({ schemaVersion: 1, vehicleId: preview.vehicle.id, vehicleVersion: preview.vehicleVersion,
    publicContentRevision: preview.publicContentRevision, fingerprint: preview.fingerprint, locale: preview.locale,
    requiredFieldsReady, localizationReady, previewConfirmed: confirmed, canPublish: requiredFieldsReady && localizationReady && confirmed,
    issues, confirmation: confirmed ? { locale: confirmation.locale, confirmedAt: confirmation.confirmed_at.toISOString(), expiresAt: confirmation.expires_at.toISOString() } : null });
}

export function requirePublicationReady(readiness: PublishReadiness, includePreview = true) {
  const issues = readiness.issues.filter(i => includePreview || i.stage !== 'preview');
  if (issues.length) throw new ApiError(422, 'PUBLISH_VALIDATION_FAILED', 'Vehicle is not ready to publish.',
    issues.slice(0, 100).map(({ path, code, message }) => ({ path, code, message })));
}

export function checkPreviewProof(preview: PublicationPreview, input: ConfirmPublicationPreviewRequest) {
  if (preview.vehicleVersion !== input.version || preview.publicContentRevision !== input.publicContentRevision ||
    preview.fingerprint !== input.fingerprint || preview.locale !== input.locale) throw conflict();
}
