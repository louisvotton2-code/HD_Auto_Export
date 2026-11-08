/** Browser contract simulations only; these are never operational inventory. */
import type { Page, Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { adminVehicleFixture, makeVehicleLocalizationFixture } from '@hd/contracts/fixtures';
import { DisplayTranslationSuggestionsSchema, GenerateDisplayTranslationsSchema, GenerateVehicleTranslationsRequestSchema, SaveVehicleLocalizationSchema, VehicleLocalizationSchema, VehicleTranslationSuggestionsResponseSchema, type AdminVehicle, type DisplayField, type DisplayTranslationSuggestions, type SaveVehicleLocalization, type StaffMe, type TranslatableField, type VehicleDraftInput, type VehicleLocalization, type VehicleTranslationSuggestions } from '@hd/contracts/admin';

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
export function displaySuggestions(saved: VehicleLocalization, refs: string[]): DisplayTranslationSuggestions {
  return DisplayTranslationSuggestionsSchema.parse({ vehicleId: saved.vehicleId, vehicleVersion: saved.vehicleVersion, revision: saved.revision,
    fields: refs.map(ref => {
      const field = saved.data.fields.find(field => field.ref === ref);
      if (!field) throw new Error(`Unknown simulated GET ref: ${ref}`);
      return { ...structuredClone(field), translations: Object.fromEntries((['zh', 'en', 'ru'] as const).map(locale => [locale, {
        text: locale === 'zh' ? field.sourceText : locale === 'en' ? `Synthetic English ${ref}` : `Тестовый перевод ${ref}`,
        kind: locale === 'zh' ? 'original' : 'machine', reviewStatus: 'pending', sourceVersion: field.sourceVersion,
        humanEditVersion: field.translations[locale]?.humanEditVersion ?? 0, engineVersion: locale === 'zh' ? null : 'fixture-display-translator-v1',
      }])) };
    }) });
}

/** Same public contract, synthetic output: no external translator is contacted. */
export function translationSuggestions(record: AdminVehicle): VehicleTranslationSuggestions {
  const engineVersion = 'fixture-machine-translation-v1';
  function field(value: TranslatableField, name: 'title' | 'description') {
    if (!value.sourceText) return null;
    const versions = { zh: value.translations.zh?.humanEditVersion ?? null, en: value.translations.en?.humanEditVersion ?? null, ru: value.translations.ru?.humanEditVersion ?? null };
    const common = { reviewStatus: 'pending' as const, sourceVersion: value.sourceVersion };
    return {
      sourceLanguage: value.sourceLanguage, sourceText: value.sourceText, sourceVersion: value.sourceVersion,
      sourceHash: createHash('sha256').update(JSON.stringify([value.sourceLanguage, value.sourceText])).digest('hex'),
      targetHumanEditVersions: versions,
      translations: {
        zh: { ...common, text: value.sourceText, kind: 'original' as const, humanEditVersion: versions.zh ?? 0, engineVersion: null },
        en: { ...common, text: `Machine generated ${name}`, kind: 'machine' as const, humanEditVersion: versions.en ?? 0, engineVersion },
        ru: { ...common, text: name === 'title' ? 'Машинный заголовок' : 'Машинное описание', kind: 'machine' as const, humanEditVersion: versions.ru ?? 0, engineVersion },
      },
    };
  }
  return VehicleTranslationSuggestionsResponseSchema.parse(envelope({
    vehicleId: record.id, version: record.version, engineVersion,
    content: { title: field(record.draft.content.title, 'title'), description: field(record.draft.content.description, 'description') },
  })).data;
}

function publicDraft(draft: VehicleDraftInput) {
  return JSON.stringify({ source: draft.source, facts: draft.facts, price: draft.price, content: draft.content, media: draft.media });
}
const emptyDisplayData = () => ({ facts: { generation: null, drivetrain: null }, fields: [] });

export async function installApi(page: Page, options: {
  authenticated?: boolean;
  items?: AdminVehicle[];
  permissions?: StaffMe['permissions'];
  createdId?: string;
  localizations?: VehicleLocalization[];
} = {}) {
  const state = {
    authenticated: options.authenticated ?? true,
    items: options.items ?? [],
    me: { ...staff, permissions: options.permissions ?? staff.permissions },
    creates: [] as Array<{ key: string | undefined; body: string | null }>,
    saves: [] as Array<{ version: number; draft: VehicleDraftInput }>,
    lifecycle: [] as Array<{ operation: 'delete' | 'restore'; key: string | undefined; body: string | null }>,
    translations: [] as Array<{ id: string; key: string | undefined; body: string | null }>,
    localizations: new Map((options.localizations ?? []).map(saved => [saved.vehicleId, saved])),
    localizationReads: [] as string[],
    localizationSaves: [] as Array<{ id: string; input: SaveVehicleLocalization }>,
    localizationTranslations: [] as Array<{ id: string; key: string | undefined; body: string | null }>,
  };
  const receipts = new Map<string, { body: string | null; data: AdminVehicle }>();
  const translationReceipts = new Map<string, { body: string | null; data: VehicleTranslationSuggestions }>();
  const displayReceipts = new Map<string, { body: string | null; data: DisplayTranslationSuggestions }>();
  const publishedDrafts = new Map(state.items.filter(item => item.publishedRevisionId && item.hasUnpublishedChanges === false).map(item => [item.id, publicDraft(item.draft)]));
  const publishedLocalizations = new Map(state.items.filter(item => item.publishedRevisionId && item.hasUnpublishedChanges === false).map(item => [item.id, JSON.stringify(state.localizations.get(item.id)?.data ?? emptyDisplayData())]));
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
        const created = { ...vehicle(), id: options.createdId ?? vehicle().id, draft: request.postDataJSON().draft };
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
    const item = state.items.find(item => [`/api/v1/admin/vehicles/${item.id}`, `/api/v1/admin/vehicles/${item.id}/restore`, `/api/v1/admin/vehicles/${item.id}/translation-suggestions`, `/api/v1/admin/vehicles/${item.id}/localization`, `/api/v1/admin/vehicles/${item.id}/localization/translation-suggestions`].includes(url.pathname));
    if (item) {
      if (url.pathname.includes('/localization')) {
        // Historical UI-only fixtures use opaque IDs; new sidecar scenarios use real UUID shapes.
        if (!VehicleLocalizationSchema.shape.vehicleId.safeParse(item.id).success) return reply(route, error('NOT_FOUND'), 404);
        const saved = state.localizations.get(item.id) ?? localization(item);
        state.localizations.set(item.id, saved); saved.vehicleVersion = item.version;
        if (url.pathname.endsWith('/translation-suggestions') && request.method() === 'POST') {
          const body = request.postData(); const key = request.headers()['idempotency-key'];
          const input = GenerateDisplayTranslationsSchema.parse(request.postDataJSON());
          state.localizationTranslations.push({ id: item.id, key, body });
          if (!key) return reply(route, error('INVALID_REQUEST'), 400);
          const receiptKey = `${item.id}:${key}`; const receipt = displayReceipts.get(receiptKey);
          if (receipt) return receipt.body === body ? reply(route, envelope(receipt.data)) : reply(route, error('IDEMPOTENCY_CONFLICT'), 409);
          if (item.deletedAt) return reply(route, error('NOT_FOUND'), 404);
          if (input.vehicleVersion !== item.version || input.revision !== saved.revision) return reply(route, error('VERSION_CONFLICT'), 409);
          if (input.refs.some(ref => !/^zh(?:-|$)/i.test(saved.data.fields.find(field => field.ref === ref)?.sourceLanguage ?? ''))) return reply(route, error('TRANSLATION_SOURCE_UNSUPPORTED'), 422);
          const data = displaySuggestions(saved, input.refs);
          displayReceipts.set(receiptKey, { body, data: structuredClone(data) });
          return reply(route, envelope(data));
        }
        if (item.deletedAt) return reply(route, error('NOT_FOUND'), 404);
        if (request.method() === 'GET') {
          state.localizationReads.push(item.id);
          return reply(route, envelope(VehicleLocalizationSchema.parse(saved)));
        }
        if (request.method() === 'PUT') {
          const input = SaveVehicleLocalizationSchema.parse(request.postDataJSON());
          state.localizationSaves.push({ id: item.id, input: structuredClone(input) });
          if (input.vehicleVersion !== item.version || input.revision !== saved.revision || input.data.fields.length !== saved.data.fields.length) return reply(route, error('VERSION_CONFLICT'), 409);
          const data = structuredClone(input.data);
          for (const field of data.fields) {
            const old = saved.data.fields.find(old => old.ref === field.ref);
            if (!old || field.sourceText !== old.sourceText || field.sourceHash !== old.sourceHash || field.sourceVersion !== old.sourceVersion) return reply(route, error('VERSION_CONFLICT'), 409);
            const changedLanguage = old.sourceLanguage !== field.sourceLanguage;
            for (const locale of ['zh', 'en', 'ru'] as const) {
              const value = field.translations[locale]; const prior = old.translations[locale];
              if (!value) continue;
              if (value.humanEditVersion !== (prior?.humanEditVersion ?? 0)) return reply(route, error('VERSION_CONFLICT'), 409);
              if (value.kind === 'machine' && prior && (prior.kind === 'human' || prior.reviewStatus === 'approved') && value.text !== prior.text) return reply(route, error('VERSION_CONFLICT'), 409);
              if (changedLanguage || value.sourceVersion !== field.sourceVersion) value.reviewStatus = 'stale';
              const changed = !prior || ['text', 'kind', 'reviewStatus', 'sourceVersion'].some(key => value[key as keyof typeof value] !== prior[key as keyof typeof prior]);
              value.humanEditVersion = (prior?.humanEditVersion ?? 0) + (changed ? 1 : 0);
            }
            if (changedLanguage) {
              field.sourceVersion++;
              // This is an opaque simulated server hash, never computed by the browser UI.
              field.sourceHash = createHash('sha256').update(JSON.stringify(['fixture-binding', field.ref, field.sourceLanguage, field.sourceText])).digest('hex');
            }
          }
          if (JSON.stringify(data.facts.generation) !== JSON.stringify(saved.data.facts.generation)) {
            const old = data.fields.find(field => field.ref === 'generation');
            data.fields = data.fields.filter(field => field.ref !== 'generation');
            if (data.facts.generation) data.fields.push({ ref: 'generation', sourceText: data.facts.generation.name, sourceLanguage: old?.sourceLanguage ?? 'und',
              sourceHash: createHash('sha256').update(JSON.stringify(['fixture-generation', data.facts.generation])).digest('hex'), sourceVersion: old ? old.sourceVersion + 1 : 1,
              translations: old ? Object.fromEntries(Object.entries(old.translations).map(([locale, value]) => [locale, value ? { ...value, reviewStatus: 'stale' } : null])) as DisplayField['translations'] : { zh: null, en: null, ru: null } });
          }
          item.version++; item.hasUnpublishedChanges = true;
          Object.assign(saved, { data, revision: saved.revision + 1, vehicleVersion: item.version });
          return reply(route, envelope(VehicleLocalizationSchema.parse(saved)));
        }
        return reply(route, error('INVALID_REQUEST'), 400);
      }
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
      if (url.pathname.endsWith('/translation-suggestions') && request.method() === 'POST') {
        const body = request.postData(); const key = request.headers()['idempotency-key'];
        const input = GenerateVehicleTranslationsRequestSchema.parse(request.postDataJSON());
        state.translations.push({ id: item.id, key, body });
        if (!key) return reply(route, error('INVALID_REQUEST'), 400);
        const receiptKey = `${item.id}:${key}`; const existing = translationReceipts.get(receiptKey);
        if (existing) return existing.body === body ? reply(route, envelope(existing.data)) : reply(route, error('IDEMPOTENCY_CONFLICT'), 409);
        if (input.version !== item.version) return reply(route, error('VERSION_CONFLICT'), 409);
        const data = translationSuggestions(item); translationReceipts.set(receiptKey, { body, data: structuredClone(data) });
        return reply(route, envelope(data));
      }
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        state.saves.push(body);
        if (item.publishedRevisionId && item.hasUnpublishedChanges === false) { publishedDrafts.set(item.id, publicDraft(item.draft)); publishedLocalizations.set(item.id, JSON.stringify(state.localizations.get(item.id)?.data ?? emptyDisplayData())); }
        const published = publishedDrafts.get(item.id);
        Object.assign(item, { draft: body.draft, version: item.version + 1,
          hasUnpublishedChanges: !item.publishedRevisionId || published === undefined ? true : publicDraft(body.draft) !== published || JSON.stringify(state.localizations.get(item.id)?.data ?? emptyDisplayData()) !== publishedLocalizations.get(item.id) });
      }
      return reply(route, envelope(item));
    }
    return reply(route, error('NOT_FOUND'), 404);
  });
  return state;
}
