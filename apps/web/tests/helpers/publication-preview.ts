import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { PublicationPreviewFrameMessageSchema, type Locale, type PublicationPreviewFrameMessage } from '@hd/contracts/admin';

export const previewVehicleId = '00000000-0000-4000-8000-000000000001';
export const secondPreviewVehicleId = '00000000-0000-4000-8000-000000000003';
export const previewLoadId = '10000000-0000-4000-8000-000000000001';
export const nextPreviewLoadId = '10000000-0000-4000-8000-000000000002';
export const previewStaffCookie = 'hd-preview-staff';

function fixtureOrigin() {
  const value = process.env.PUBLIC_FIXTURE_API_URL;
  if (!value) throw new Error('Publication preview tests require an isolated PUBLIC_FIXTURE_API_URL.');
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || ['3320', '3363'].includes(url.port) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Publication preview tests must use a dedicated loopback fixture API.');
  return url.origin;
}

export function previewHref(locale: Locale, loadId = previewLoadId, vehicleId = previewVehicleId) {
  return `/staff/vehicles/${encodeURIComponent(vehicleId)}/publication-preview/?${new URLSearchParams({ locale, loadId })}`;
}

export async function authorizePreview(context: BrowserContext, origin: string) {
  await context.addCookies([{
    name: previewStaffCookie, value: 'authorized', domain: new URL(origin).hostname,
    path: '/api', httpOnly: true, sameSite: 'Strict', secure: false,
  }]);
}

/** The standalone web test server has no staff reverse proxy. Forward only these isolated GETs. */
export async function installPreviewTransport(page: Page, request: APIRequestContext) {
  const fixture = fixtureOrigin();
  const health = await request.get(fixture + '/__fixtures/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ suite: 'hd-web-public-catalog-v1' });
  const reads: { path: string; locale: string | null; method: string; cookie: string | undefined; completed: boolean }[] = [];
  const publicReads: string[] = [];
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (/^\/api\/v1\/(vehicles|home\/vehicles|vehicle-filters)(\/|$)/.test(path)) publicReads.push(path);
  });
  await page.route('**/api/v1/admin/**', async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    const headers = await incoming.allHeaders();
    const read = { path: url.pathname, locale: url.searchParams.get('locale'), method: incoming.method(), cookie: headers.cookie, completed: false };
    reads.push(read);
    // An unexpected confirmation or mutation is recorded and rejected inside the test boundary.
    if (incoming.method() !== 'GET') {
      read.completed = true;
      return route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
    }
    try {
      const result = await request.get(fixture + url.pathname + url.search, { headers, maxRedirects: 0 });
      await route.fulfill({ response: result });
    } catch (error) {
      if (!page.isClosed() && !incoming.failure()) throw error;
    } finally {
      read.completed = true;
    }
  });
  return { reads, publicReads };
}

export async function openPreviewHost(page: Page, locale: Locale, loadId = previewLoadId) {
  const child = previewHref(locale, loadId);
  await page.route('**/admin/preview-test/', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="en"><head><title>Isolated staff preview host</title></head>
<body style="margin:0"><iframe id="publication-frame" title="Publication preview" style="border:0;width:100%;height:1100px"></iframe>
<script>
window.__publicationMessages = [];
window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'hd:auto:publication-preview') return;
  const frame = document.getElementById('publication-frame');
  let bodyRendered = false;
  try { bodyRendered = !!frame.contentDocument?.querySelector('[data-testid="publication-preview-body"]'); } catch {}
  window.__publicationMessages.push({data:event.data,origin:event.origin,fromChild:event.source===frame.contentWindow,bodyRendered});
});
document.getElementById('publication-frame').src = ${JSON.stringify(child)};
</script></body></html>`,
  }));
  await page.goto('/admin/preview-test/');
  return page.frameLocator('#publication-frame');
}

export interface PreviewObservation {
  data: PublicationPreviewFrameMessage;
  origin: string;
  fromChild: boolean;
  bodyRendered: boolean;
}

export async function previewMessages(page: Page): Promise<PreviewObservation[]> {
  const observations = await page.evaluate(() => Reflect.get(window, '__publicationMessages') ?? []);
  return observations.map((observation: Omit<PreviewObservation, 'data'> & { data: unknown }) => ({
    ...observation, data: PublicationPreviewFrameMessageSchema.parse(observation.data),
  }));
}

export async function waitForPreviewEvent(page: Page, event: PublicationPreviewFrameMessage['event'], loadId = previewLoadId) {
  await expect.poll(async () => (await previewMessages(page)).some((entry) => entry.data.event === event && entry.data.loadId === loadId)).toBe(true);
  return (await previewMessages(page)).filter((entry) => entry.data.event === event && entry.data.loadId === loadId).at(-1)!;
}
