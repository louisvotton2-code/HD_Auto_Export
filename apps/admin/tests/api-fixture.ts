/** Browser contract simulations only; these are never operational inventory. */
import type { Page, Route } from '@playwright/test';
import { adminVehicleFixture } from '@hd/contracts/fixtures';
import { type AdminVehicle, type StaffMe, type VehicleDraftInput } from '@hd/contracts/admin';

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
export function vehicle(): AdminVehicle { return structuredClone(adminVehicleFixture); }

export async function installApi(page: Page, options: {
  authenticated?: boolean;
  items?: AdminVehicle[];
  permissions?: StaffMe['permissions'];
} = {}) {
  const state = {
    authenticated: options.authenticated ?? true,
    items: options.items ?? [],
    me: { ...staff, permissions: options.permissions ?? staff.permissions },
    creates: [] as Array<{ key: string | undefined; body: string | null }>,
    saves: [] as Array<{ version: number; draft: VehicleDraftInput }>,
    lifecycle: [] as Array<{ operation: 'delete' | 'restore'; key: string | undefined; body: string | null }>,
  };
  const receipts = new Map<string, { body: string | null; data: AdminVehicle }>();
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
        const created = { ...vehicle(), draft: request.postDataJSON().draft };
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
    const item = state.items.find(item => url.pathname === `/api/v1/admin/vehicles/${item.id}` || url.pathname === `/api/v1/admin/vehicles/${item.id}/restore`);
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
          publishedAt: null, availability: 'unknown', availabilityCheckedAt: null,
        });
        receipts.set(receiptKey, { body, data: structuredClone(item) });
        return reply(route, envelope(item));
      }
      if (item.deletedAt && !(request.method() === 'GET' && url.searchParams.get('includeDeleted') === 'true')) return reply(route, error('NOT_FOUND'), 404);
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        state.saves.push(body);
        Object.assign(item, { draft: body.draft, version: item.version + 1 });
      }
      return reply(route, envelope(item));
    }
    return reply(route, error('NOT_FOUND'), 404);
  });
  return state;
}
