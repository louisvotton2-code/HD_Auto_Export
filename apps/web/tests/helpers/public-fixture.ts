import { expect, type APIRequestContext } from '@playwright/test';

const suite = 'hd-web-public-catalog-v1';
const fixtureBase = process.env.PUBLIC_FIXTURE_API_URL;
if (fixtureBase) {
  const url = new URL(fixtureBase);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port === '3320' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Use a dedicated loopback public fixture API, never the operating API 3320.');
}

export const publicFixtureLabels = {
  zh: {
    title: '展示车型 Alpha',
    demo: '展示样例，非实际库存',
    section: '配置精选',
    manual: '精选车型',
  },
  en: {
    title: 'Showcase Alpha',
    demo: 'Display example, not actual inventory',
    section: 'Configured selection',
    manual: 'Selected vehicle',
  },
  ru: {
    title: 'Образец Alpha',
    demo: 'Демонстрационный образец, не реальное наличие',
    section: 'Подборка из настроек',
    manual: 'Подобранный автомобиль',
  },
} as const;

async function verifyFixture(request: APIRequestContext) {
  if (!fixtureBase)
    throw new Error(
      'This state-changing regression needs PUBLIC_FIXTURE_API_URL pointing at the isolated fixture server.',
    );
  const health = await request.get(`${fixtureBase}/__fixtures/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ suite });
}

/** External read-only runs never send fixture controls to a real inventory API. */
export async function resetPublicFixture(request: APIRequestContext) {
  if (!fixtureBase) return;
  await verifyFixture(request);
  const response = await request.post(`${fixtureBase}/__fixtures/reset`);
  expect(response.status()).toBe(200);
  expect((await response.json()).suite).toBe(suite);
}

/** State changes are confined to the health-marked loopback test server. */
export async function setPublicFixtureState(
  request: APIRequestContext,
  state: Record<string, unknown>,
) {
  await verifyFixture(request);
  const response = await request.put(`${fixtureBase}/__fixtures/state`, { data: state });
  expect(response.status()).toBe(200);
  expect((await response.json()).suite).toBe(suite);
}

export async function patchPublicFixture(
  request: APIRequestContext,
  data: { sectionCount?: 0 | 1 | 2; mode?: 'normal' | 'empty' | 'unavailable' | 'malformed' },
) {
  await verifyFixture(request);
  const response = await request.put(`${fixtureBase}/__fixtures/state`, { data });
  expect(response.status()).toBe(200);
  expect((await response.json()).suite).toBe(suite);
}
