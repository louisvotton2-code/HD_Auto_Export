/** Browser contract simulations only; these are never operational inventory. */
import type { Page, Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { adminVehicleFixture, makeVehicleLocalizationFixture, makePublicationPreviewFixture, makePublishReadinessFixture } from '@hd/contracts/fixtures';
import { VehicleLocalizationSchema, type AdminVehicle, type DisplayField, type StaffMe, type TranslatableField, type VehicleDraftInput, type VehicleLocalization } from '@hd/contracts/admin';

import { PublicationPreviewFrameMessageSchema, ConfirmPublicationPreviewRequestSchema, LocaleSchema, PublicationPreviewSchema, PublicationPreviewResponseSchema, PublishReadinessSchema, PublishReadinessResponseSchema, type ConfirmPublicationPreviewRequest, type Locale, type PublicationPreview, type PublishReadiness } from '@hd/contracts/admin';
import { CreateTranslationPlanRequestSchema, GenerateTranslationPlanRequestSchema, SaveVehicleTranslationBundleSchema, VehicleTranslationBundleResponseSchema, TranslationPlanResponseSchema, TranslationPlanResultResponseSchema, TranslationPlanStatusSchema, TranslationPlanStatusResponseSchema, parseVehicleDraftWrite, type SaveVehicleTranslationBundle, type TranslationPlan, type TranslationPlanStatus } from '@hd/contracts/admin';
import { syntheticHash, translationBundle, translationPlan, translationResult } from './translation-fixture';
export { translationBundle, translationResult } from './translation-fixture';

export const staff: StaffMe = {
  id: 'fixture_staff', name: '测试编辑员', role: 'editor',
  permissions: ['vehicles:read', 'vehicles:write', 'vehicles:publish', 'media:write', 'home:write'],
};
export const envelope = (data: unknown) => ({ data, meta: { requestId: 'browser-contract-test' } });
export const error = (code: string) => ({
  error: { code, message: 'Simulated API failure', retryable: false },
  meta: { requestId: 'browser-contract-test' },
});
export const reply = (route: Route, data: unknown, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(data),
});
export function vehicle(): AdminVehicle { return { ...structuredClone(adminVehicleFixture), hasUnpublishedChanges: true }; }

/** Only refs supplied by the simulated GET exist; clients must never derive their own refs. */
export function localization(record: AdminVehicle, fields: DisplayField[] = []): VehicleLocalization {
  return VehicleLocalizationSchema.parse({ ...makeVehicleLocalizationFixture(), vehicleId: record.id, vehicleVersion: record.version, revision: 0,
    data: { facts: { generation: null, drivetrain: null }, fields }, retiredFieldCount: 0 });
}
/** Simulates the BE normalization only after an explicit write; GET never mutates source metadata. */
function normalizeChinese(field: TranslatableField) {
  if (field.sourceLanguage.split('-')[0].toLowerCase() !== 'zh') return;
  const previous = field.translations.zh;
  if (!field.sourceText?.trim()) { field.translations.zh = null; return; }
  if (previous && previous.text === field.sourceText && previous.kind === 'original' && previous.sourceVersion === field.sourceVersion && previous.engineVersion === null && previous.reviewStatus !== 'stale') return;
  field.translations.zh = { text: field.sourceText, kind: 'original', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
    humanEditVersion: (previous?.humanEditVersion ?? 0) + 1, engineVersion: null };
}

function publicDraft(draft: VehicleDraftInput) {
  return JSON.stringify({ source: draft.source, facts: draft.facts, price: draft.price, content: draft.content, media: draft.media, configuration: draft.configuration ?? null });
}
export const publicationKey = (id: string, locale: Locale = 'zh') => `${id}:${locale}`;
const emptyDisplayData = () => ({ facts: { generation: null, drivetrain: null }, fields: [] });

export async function installApi(page: Page, options: {
  authenticated?: boolean;
  items?: AdminVehicle[];
  permissions?: StaffMe['permissions'];
  createdId?: string;
  localizations?: VehicleLocalization[];
  publicationReadiness?: PublishReadiness[];
  publicationPreviews?: PublicationPreview[];
  publicationDefaultConfirmed?: boolean;
} = {}) {
  const state = {
    authenticated: options.authenticated ?? true,
    items: options.items ?? [],
    me: { ...staff, permissions: options.permissions ?? staff.permissions },
    creates: [] as Array<{ key: string | undefined; body: string | null }>,
    saves: [] as Array<{ version: number; draft: VehicleDraftInput }>,
    lifecycle: [] as Array<{ operation: 'delete' | 'restore'; key: string | undefined; body: string | null }>,
    localizations: new Map((options.localizations ?? []).map(saved => [saved.vehicleId, saved])),
    bundleReads: [] as string[],
    bundleSaves: [] as Array<{ id: string; input: SaveVehicleTranslationBundle }>,
    translationPlans: [] as Array<{ id: string; input: { version: number }; plan: TranslationPlan }>,
    translationGenerations: [] as Array<{ id: string; planId: string; key: string | undefined; body: string | null }>,
    translationStatusReads: [] as string[],
    translationStatuses: new Map<string, TranslationPlanStatus>(),
    publishReadiness: new Map((options.publicationReadiness ?? []).map(value => [publicationKey(value.vehicleId, value.locale), PublishReadinessSchema.parse(value)])),
    publicationPreviews: new Map((options.publicationPreviews ?? []).map(value => [publicationKey(value.vehicle.id, value.locale), PublicationPreviewSchema.parse(value)])),
    readinessReads: [] as Array<{ id: string; locale: Locale }>,
    publicationPreviewReads: [] as Array<{ id: string; locale: Locale }>,
    previewConfirmations: [] as Array<{ id: string; input: ConfirmPublicationPreviewRequest }>,
  };
  const generationReceipts = new Map<string, { body: string | null; data: ReturnType<typeof translationResult> }>();
  const receipts = new Map<string, { body: string | null; data: AdminVehicle }>();
  const publishedDrafts = new Map(state.items.filter(item => item.publishedRevisionId && item.hasUnpublishedChanges === false).map(item => [item.id, publicDraft(item.draft)]));
  const publishedLocalizations = new Map(state.items.filter(item => item.publishedRevisionId && item.hasUnpublishedChanges === false).map(item => [item.id, JSON.stringify(state.localizations.get(item.id)?.data ?? emptyDisplayData())]));
  const previewIssue = { stage: 'preview' as const, path: 'publicationPreview', code: 'PREVIEW_CONFIRMATION_REQUIRED', message: '请核对当前发布预览并确认。' };
  function expireConfirmation(value: PublishReadiness): PublishReadiness {
    return PublishReadinessSchema.parse({ ...value, previewConfirmed: false, canPublish: false, confirmation: null,
      issues: [...value.issues.filter(issue => issue.stage !== 'preview'), previewIssue] });
  }
  function readinessFor(item: AdminVehicle, locale: Locale): PublishReadiness {
    const key = publicationKey(item.id, locale);
    let value = state.publishReadiness.get(key);
    if (!value) {
      // Legacy UI regressions assume server checks and a current confirmation were completed before their scenario.
      // Workflow tests override these official fixtures explicitly; this is not a browser implementation of BE validation.
      const confirmed = options.publicationDefaultConfirmed ?? true;
      const now = Date.now();
      value = PublishReadinessSchema.parse({ ...makePublishReadinessFixture(confirmed), vehicleId: item.id,
        vehicleVersion: item.version, locale,
        confirmation: confirmed ? { locale, confirmedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString() } : null });
    }
    value = PublishReadinessSchema.parse({ ...value, vehicleVersion: item.version });
    if (value.confirmation && Date.parse(value.confirmation.expiresAt) <= Date.now()) value = expireConfirmation(value);
    state.publishReadiness.set(key, value);
    return value;
  }
  function updatePublicationState(item: AdminVehicle, publicChanged: boolean) {
    for (const [key, value] of state.publishReadiness) {
      if (value.vehicleId !== item.id) continue;
      const next = PublishReadinessSchema.parse({ ...value, vehicleVersion: item.version,
        ...(publicChanged ? { publicContentRevision: value.publicContentRevision + 1,
          fingerprint: createHash('sha256').update(JSON.stringify(['synthetic-public-revision', value.fingerprint, item.version])).digest('hex') } : {}) });
      state.publishReadiness.set(key, publicChanged ? expireConfirmation(next) : next);
    }
  }
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/sign-in/email') {
      const credentials = request.postDataJSON();
      if (credentials.password === 'incorrect-password') return reply(route, { code: 'INVALID_EMAIL_OR_PASSWORD' }, 401);
      state.authenticated = true;
      return reply(route, { user: { id: staff.id }, token: 'fixture-unused-token' });
    }
    if (url.pathname === '/api/auth/sign-out') {
      state.authenticated = false;
      return reply(route, { success: true });
    }
    if (!state.authenticated) return reply(route, error('UNAUTHENTICATED'), 401);
    if (url.pathname === '/api/v1/admin/me') return reply(route, envelope(state.me));
    if (url.pathname === '/api/v1/admin/vehicle-filters') return reply(route, envelope({
      scope: 'all_inventory',
      makes: [...new Map(state.items.filter(item => !item.deletedAt).flatMap(item => item.draft.facts.make ? [[item.draft.facts.make.id, { ...item.draft.facts.make, count: 1 }] as const] : [])).values()],
      models: [...new Map(state.items.filter(item => !item.deletedAt).flatMap(item => item.draft.facts.make && item.draft.facts.model ? [[`${item.draft.facts.make.id}:${item.draft.facts.model.id}`, { ...item.draft.facts.model, makeId: item.draft.facts.make.id, count: 1 }] as const] : [])).values()],
      powertrains: [],
    }));
    if (url.pathname === '/api/v1/admin/vehicles') {
      if (request.method() === 'POST') {
        state.creates.push({ key: request.headers()['idempotency-key'], body: request.postData() });
        const created = { ...vehicle(), id: options.createdId ?? vehicle().id, draft: parseVehicleDraftWrite(request.postDataJSON().draft) };
        normalizeChinese(created.draft.content.title); normalizeChinese(created.draft.content.description);
        state.items.push(created);
        return reply(route, envelope(created), 201);
      }
      const pageNumber = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('pageSize') ?? '24');
      const filtered = state.items.filter(item =>
        (url.searchParams.get('deleted') === 'only' ? Boolean(item.deletedAt) : !item.deletedAt) &&
        (!url.searchParams.has('publicationState') || item.publicationState === url.searchParams.get('publicationState')) &&
        (!url.searchParams.has('availability') || item.availability === url.searchParams.get('availability')) &&
        (!url.searchParams.has('make') || item.draft.facts.make?.id === url.searchParams.get('make')) &&
        (!url.searchParams.has('model') || item.draft.facts.model?.id === url.searchParams.get('model')) &&
        (!url.searchParams.has('q') || JSON.stringify(item).includes(url.searchParams.get('q')!)));
      return reply(route, envelope({
        items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        page: pageNumber, pageSize, total: filtered.length, hasMore: pageNumber * pageSize < filtered.length,
      }));
    }
    const publicationPath = url.pathname.match(/^\/api\/v1\/admin\/vehicles\/([^/]+)\/(publish-readiness|publication-preview)(\/confirm)?$/);
    if (publicationPath) {
      const item = state.items.find(value => value.id === publicationPath[1]);
      if (!item || item.deletedAt) return reply(route, error('NOT_FOUND'), 404);
      if (publicationPath[2] === 'publication-preview' && publicationPath[3] === '/confirm' && request.method() === 'POST') {
        const parsed = ConfirmPublicationPreviewRequestSchema.safeParse(request.postDataJSON());
        if (!parsed.success) return reply(route, error('INVALID_REQUEST'), 400);
        const input = parsed.data;
        state.previewConfirmations.push({ id: item.id, input: structuredClone(input) });
        const current = readinessFor(item, input.locale);
        if (input.version !== item.version || input.publicContentRevision !== current.publicContentRevision || input.fingerprint !== current.fingerprint || input.locale !== current.locale)
          return reply(route, error('VERSION_CONFLICT'), 409);
        if (!current.requiredFieldsReady || !current.localizationReady) return reply(route, error('PUBLISH_VALIDATION_FAILED'), 422);
        const now = Date.now();
        const confirmed = PublishReadinessSchema.parse({ ...current, previewConfirmed: true, canPublish: true,
          confirmation: { locale: input.locale, confirmedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString() },
          issues: current.issues.filter(issue => issue.stage !== 'preview') });
        state.publishReadiness.set(publicationKey(item.id, input.locale), confirmed);
        return reply(route, PublishReadinessResponseSchema.parse(envelope(confirmed)));
      }
      if (request.method() !== 'GET' || publicationPath[3]) return reply(route, error('INVALID_REQUEST'), 400);
      const parsedLocale = LocaleSchema.safeParse(url.searchParams.get('locale') ?? 'zh');
      if (!parsedLocale.success) return reply(route, error('INVALID_REQUEST'), 400);
      const locale = parsedLocale.data;
      const gate = readinessFor(item, locale);
      if (publicationPath[2] === 'publish-readiness') {
        state.readinessReads.push({ id: item.id, locale });
        return reply(route, PublishReadinessResponseSchema.parse(envelope(gate)));
      }
      state.publicationPreviewReads.push({ id: item.id, locale });
      const base = state.publicationPreviews.get(publicationKey(item.id, locale)) ?? makePublicationPreviewFixture(locale);
      const preview = PublicationPreviewSchema.parse({ ...base, locale, vehicleVersion: item.version,
        publicContentRevision: gate.publicContentRevision, fingerprint: gate.fingerprint,
        vehicle: { ...base.vehicle, id: item.id, stockCode: item.stockCode } });
      return reply(route, PublicationPreviewResponseSchema.parse(envelope(preview)));
    }
    const unifiedPath = url.pathname.match(/^\/api\/v1\/admin\/vehicles\/([^/]+)\/(translation-bundle|translation-plans)(?:\/([^/]+)(\/generate)?)?$/);
    if (unifiedPath) {
      const item = state.items.find(value => value.id === unifiedPath[1]);
      if (!item || item.deletedAt || !VehicleLocalizationSchema.shape.vehicleId.safeParse(item.id).success) return reply(route, error('NOT_FOUND'), 404);
      const saved = state.localizations.get(item.id) ?? localization(item); saved.vehicleVersion = item.version;
      state.localizations.set(item.id, saved);
      const bundle = () => translationBundle(item, saved);
      if (unifiedPath[2] === 'translation-bundle') {
        if (request.method() === 'GET') { state.bundleReads.push(item.id); return reply(route, VehicleTranslationBundleResponseSchema.parse(envelope(bundle()))); }
        if (request.method() !== 'PUT') return reply(route, error('INVALID_REQUEST'), 400);
        const input = SaveVehicleTranslationBundleSchema.parse(request.postDataJSON());
        state.bundleSaves.push({ id: item.id, input: structuredClone(input) });
        if (input.version !== item.version || input.localizationRevision !== saved.revision || input.localization.fields.length !== saved.data.fields.length) return reply(route, error('VERSION_CONFLICT'), 409);
        const content = structuredClone(input.content); const data = structuredClone(input.localization);
        function updateField(next: TranslatableField & { sourceHash?: string }, prior: TranslatableField & { sourceHash?: string }, ref: string) {
          if (next.sourceText !== prior.sourceText || next.sourceVersion !== prior.sourceVersion || next.sourceLanguage !== prior.sourceLanguage || next.sourceHash !== prior.sourceHash) throw new Error('VERSION_CONFLICT');
          for (const locale of ['zh', 'en', 'ru'] as const) {
            const value = next.translations[locale]; const old = prior.translations[locale];
            if (!value) continue;
            if (value.humanEditVersion !== (old?.humanEditVersion ?? 0) || value.sourceVersion !== prior.sourceVersion && value.sourceVersion !== old?.sourceVersion) throw new Error('VERSION_CONFLICT');
            if (old && value.kind === 'machine' && (old.kind === 'human' || old.reviewStatus === 'approved') && value.text !== old.text) throw new Error('VERSION_CONFLICT');
            const changed = !old || ['text', 'kind', 'reviewStatus', 'sourceVersion'].some(key => value[key as keyof typeof value] !== old[key as keyof typeof old]);
            value.humanEditVersion = (old?.humanEditVersion ?? 0) + (changed ? 1 : 0);
          }
          if (input.sourceLanguageConfirmations.includes(ref as never)) {
            next.sourceLanguage = 'zh'; next.sourceVersion++;
            if (next.sourceHash !== undefined) next.sourceHash = syntheticHash(['fixture-confirmed-source', ref, next.sourceText, next.sourceVersion]);
            for (const value of Object.values(next.translations)) if (value) value.reviewStatus = 'stale';
          }
        }
        try {
          for (const name of ['title', 'description'] as const) updateField(content[name], item.draft.content[name], `content.${name}`);
          for (const field of data.fields) {
            const prior = saved.data.fields.find(value => value.ref === field.ref); if (!prior) throw new Error('VERSION_CONFLICT');
            updateField(field, prior, field.ref);
          }
        } catch { return reply(route, error('VERSION_CONFLICT'), 409); }
        let retiredFieldCount = saved.retiredFieldCount;
        if (JSON.stringify(data.facts.generation) !== JSON.stringify(saved.data.facts.generation)) {
          // Match the BE's apply-then-sync behavior: retain accepted target text on a renamed binding.
          const prior = data.fields.find(field => field.ref === 'generation');
          data.fields = data.fields.filter(field => field.ref !== 'generation');
          const generation = data.facts.generation;
          if (generation) {
            const language = prior?.sourceLanguage ?? 'zh';
            const binding = syntheticHash([item.draft.facts.make?.id, item.draft.facts.model?.id, generation.id]);
            const hash = syntheticHash(['generation', binding, language, generation.name]);
            if (prior) {
              const next = structuredClone(prior);
              if (next.sourceHash !== hash) {
                next.sourceVersion++;
                for (const value of Object.values(next.translations)) if (value) value.reviewStatus = 'stale';
              }
              next.sourceText = generation.name; next.sourceHash = hash;
              normalizeChinese(next); data.fields.push(next);
            } else {
              data.fields.push({ ref: 'generation', sourceText: generation.name, sourceLanguage: language, sourceVersion: 1, sourceHash: hash,
                translations: { zh: { text: generation.name, kind: 'original', reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 0, engineVersion: null }, en: null, ru: null } });
            }
          } else if (prior) retiredFieldCount++;
        }
        normalizeChinese(content.title); normalizeChinese(content.description); data.fields.forEach(normalizeChinese);
        item.draft.content = content; item.version++; item.hasUnpublishedChanges = true;
        Object.assign(saved, { data, revision: saved.revision + 1, vehicleVersion: item.version, retiredFieldCount }); updatePublicationState(item, true);
        return reply(route, VehicleTranslationBundleResponseSchema.parse(envelope(bundle())));
      }
      const planId = unifiedPath[3];
      if (!planId && request.method() === 'POST') {
        const input = CreateTranslationPlanRequestSchema.parse(request.postDataJSON());
        if (input.version !== item.version) return reply(route, error('VERSION_CONFLICT'), 409);
        if (bundle().sourceLanguageConfirmationRequired.length) return reply(route, error('TRANSLATION_SOURCE_UNSUPPORTED'), 422);
        const plan = translationPlan(bundle(), `70000000-0000-4000-8000-${String(state.translationPlans.length + 1).padStart(12, '0')}`);
        state.translationPlans.push({ id: item.id, input, plan });
        state.translationStatuses.set(plan.id, TranslationPlanStatusSchema.parse({ planId: plan.id, vehicleId: item.id, state: 'ready', result: null, startedAt: null, finishedAt: null }));
        return reply(route, TranslationPlanResponseSchema.parse(envelope(plan)));
      }
      const plan = state.translationPlans.find(value => value.plan.id === planId && value.id === item.id)?.plan;
      if (!plan) return reply(route, error('NOT_FOUND'), 404);
      if (request.method() === 'GET' && !unifiedPath[4]) {
        state.translationStatusReads.push(plan.id);
        return reply(route, TranslationPlanStatusResponseSchema.parse(envelope(state.translationStatuses.get(plan.id))));
      }
      if (request.method() !== 'POST' || !unifiedPath[4]) return reply(route, error('INVALID_REQUEST'), 400);
      const input = GenerateTranslationPlanRequestSchema.parse(request.postDataJSON());
      const key = request.headers()['idempotency-key']; const body = request.postData();
      state.translationGenerations.push({ id: item.id, planId: plan.id, key, body });
      if (!key || input.sourceFingerprint !== plan.sourceFingerprint || input.maximumCharacters !== plan.estimate.maximumCharacters) return reply(route, error('INVALID_REQUEST'), 400);
      const receiptKey = `${item.id}:${plan.id}:${key}`; const receipt = generationReceipts.get(receiptKey);
      if (receipt) return receipt.body === body ? reply(route, TranslationPlanResultResponseSchema.parse(envelope(receipt.data))) : reply(route, error('IDEMPOTENCY_CONFLICT'), 409);
      if (Date.parse(plan.expiresAt) <= Date.now()) return reply(route, error('TRANSLATION_PLAN_EXPIRED'), 409);
      if (plan.vehicleVersion !== item.version || plan.localizationRevision !== saved.revision || plan.sourceFingerprint !== translationPlan(bundle(), plan.id).sourceFingerprint) return reply(route, error('VERSION_CONFLICT'), 409);
      const result = translationResult(bundle(), plan); const now = new Date().toISOString();
      generationReceipts.set(receiptKey, { body, data: structuredClone(result) });
      state.translationStatuses.set(plan.id, TranslationPlanStatusSchema.parse({ planId: plan.id, vehicleId: item.id, state: 'completed', result, startedAt: now, finishedAt: now }));
      return reply(route, TranslationPlanResultResponseSchema.parse(envelope(result)));
    }
    const item = state.items.find(item => [`/api/v1/admin/vehicles/${item.id}`, `/api/v1/admin/vehicles/${item.id}/restore`].includes(url.pathname));
    if (item) {
      const operation = request.method() === 'DELETE' ? 'delete' : url.pathname.endsWith('/restore') && request.method() === 'POST' ? 'restore' : null;
      if (operation) {
        const key = request.headers()['idempotency-key'];
        const body = request.postData();
        state.lifecycle.push({ operation, key, body });
        if (!key) return reply(route, error('INVALID_REQUEST'), 400);
        const receiptKey = `${operation}:${item.id}:${key}`;
        const existing = receipts.get(receiptKey);
        if (existing) return existing.body === body ? reply(route, envelope(existing.data)) : reply(route, error('IDEMPOTENCY_CONFLICT'), 409);
        if (operation === 'delete' && item.deletedAt) return reply(route, error('NOT_FOUND'), 404);
        if (request.postDataJSON().version !== item.version || operation === 'restore' && !item.deletedAt) return reply(route, error('VERSION_CONFLICT'), 409);
        Object.assign(item, operation === 'delete' ? { deletedAt: '2026-11-08T09:00:00Z', version: item.version + 1 } : {
          deletedAt: null, version: item.version + 1, publicationState: 'draft', publishedRevisionId: null,
          publishedAt: null, availability: 'unknown', availabilityCheckedAt: null, hasUnpublishedChanges: true,
        });
        if (operation === 'restore') publishedDrafts.delete(item.id);
        receipts.set(receiptKey, { body, data: structuredClone(item) });
        return reply(route, envelope(item));
      }
      if (item.deletedAt && !(request.method() === 'GET' && url.searchParams.get('includeDeleted') === 'true')) return reply(route, error('NOT_FOUND'), 404);
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        state.saves.push(body);
        if (item.publishedRevisionId && item.hasUnpublishedChanges === false) { publishedDrafts.set(item.id, publicDraft(item.draft)); publishedLocalizations.set(item.id, JSON.stringify(state.localizations.get(item.id)?.data ?? emptyDisplayData())); }
        const published = publishedDrafts.get(item.id);
        const parsedDraft = parseVehicleDraftWrite(body.draft);
        if (!Object.hasOwn(body.draft, 'configuration') && item.draft.configuration !== undefined) parsedDraft.configuration = structuredClone(item.draft.configuration);
        normalizeChinese(parsedDraft.content.title); normalizeChinese(parsedDraft.content.description);
        const publicChanged = publicDraft(item.draft) !== publicDraft(parsedDraft);
        Object.assign(item, { draft: parsedDraft, version: item.version + 1,
          hasUnpublishedChanges: !item.publishedRevisionId || published === undefined ? true : publicDraft(parsedDraft) !== published || JSON.stringify(state.localizations.get(item.id)?.data ?? emptyDisplayData()) !== publishedLocalizations.get(item.id) });
        updatePublicationState(item, publicChanged);
      }
      return reply(route, envelope(item));
    }
    return reply(route, error('NOT_FOUND'), 404);
  });
  // Legacy browser contract scenarios use this synthetic iframe, not the real FE renderer.
  // New publication workflow cases install their own later route and control every receipt explicitly.
  // The child reads the official authenticated preview endpoint; only fixed synthetic text enters its DOM.
  await page.route(/\/staff\/vehicles\/[^/]+\/publication-preview\/\?/, async route => {
    const url = new URL(route.request().url());
    const vehicleId = decodeURIComponent(url.pathname.split('/')[3]);
    const parsed = PublicationPreviewFrameMessageSchema.safeParse({ schemaVersion: 1, type: 'hd:auto:publication-preview',
      event: 'loading', loadId: url.searchParams.get('loadId'), vehicleId, locale: url.searchParams.get('locale') ?? 'zh' });
    if (!parsed.success) return route.fulfill({ status: 400, contentType: 'text/plain', body: 'Invalid synthetic preview request' });
    const shell = JSON.stringify(parsed.data).replace(/</g, '\\u003c');
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="zh"><head><meta charset="utf-8"></head>
      <body><main>合成车辆预览，仅供浏览器契约验证，不代表真实前台渲染。</main><script>
      const base = ${shell};
      const send = message => window.parent.postMessage(message, window.location.origin);
      send(base);
      window.addEventListener('pagehide', () => send({ ...base, event: 'disposed' }));
      (async () => {
        try {
          const response = await fetch('/api/v1/admin/vehicles/' + encodeURIComponent(base.vehicleId) + '/publication-preview?locale=' + base.locale,
            { credentials: 'same-origin', cache: 'no-store' });
          if (!response.ok) {
            const code = ({401:'unauthenticated',403:'forbidden',404:'not_found',409:'conflict'})[response.status] || 'unavailable';
            send({ ...base, event: 'error', error: { code } }); return;
          }
          // This response is validated against PublicationPreviewResponseSchema by installApi above.
          const { data } = await response.json();
          const preview = { vehicleId: data.vehicle.id, vehicleVersion: data.vehicleVersion,
            publicContentRevision: data.publicContentRevision, fingerprint: data.fingerprint, locale: data.locale };
          requestAnimationFrame(() => send({ ...base, event: 'ready', preview }));
        } catch { send({ ...base, event: 'error', error: { code: 'invalid_response' } }); }
      })();
      </script></body></html>` });
  });
  return state;
}
