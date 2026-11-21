// Exercise the local preview only. Sales destinations are intercepted before any network access.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const { chromium } = createRequire(resolve(__dirname, '../apps/web/package.json'))('@playwright/test');

const origin = 'http://127.0.0.1:3363';
const counter = '/api/v1/analytics/contact-count';
const sessionEvents = '/api/v1/analytics/events';
const classifications = {
  whatsapp: new Set(['wa.me', 'api.whatsapp.com', 'web.whatsapp.com']),
  telegram: new Set(['t.me', 'telegram.me']),
};

async function run() {
  const browser = await chromium.launch({ channel: 'chrome' });
  let staff;
  try {
    const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const actions = [];
    const unexpected = [];
    const externalDestinations = [];
    let acceptClicked = false;
    let sessionBatches = 0;
    let simulateFailure = false;
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) {
        if (Object.values(classifications).some(hosts => hosts.has(url.hostname)) && request.isNavigationRequest()) {
          externalDestinations.push(url.hostname);
          return route.fulfill({ contentType: 'text/html', body: '<title>Local contact destination stub</title>' });
        }
        if (/(^|\.)(facebook\.(?:com|net)|fbcdn\.net)$/.test(url.hostname)) unexpected.push('Meta');
        return route.abort();
      }
      if (url.pathname === sessionEvents) {
        if (!acceptClicked) unexpected.push('session analytics before Accept');
        sessionBatches++;
        return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' });
      }
      if (url.pathname === counter) {
        actions.push({ method: request.method(), body: request.postDataJSON(), headers: await request.allHeaders() });
        if (simulateFailure) return route.fulfill({ status: 503, body: '' });
      }
      return route.continue();
    });

    for (const locale of ['en', 'ru', 'zh']) {
      const result = await page.goto('/' + locale + '/', { waitUntil: 'domcontentloaded' });
      assert.equal(result.status(), 200);
      const banner = page.getByTestId('tracking-consent-banner');
      await banner.waitFor();
      assert.equal(await banner.getByRole('button').count(), 1, 'Expected a single acknowledgment');
      const link = new URL(await banner.getByRole('link').getAttribute('href'), origin);
      assert.equal(link.origin, origin);
      assert.equal(link.pathname.replace(/\/$/, ''), '/' + locale + '/privacy');
      const policy = await context.request.get(link.href, { maxRedirects: 2 });
      assert.equal(policy.status(), 200, 'Privacy document ' + link.pathname);
      assert.equal(new URL(policy.url()).origin, origin);
      const html = await policy.text();
      for (const contact of ['https://t.me/HD_Auto_CN', 'https://wa.me/8618215932610']) {
        assert.ok(html.includes(contact), 'Company contact on ' + link.pathname);
      }
    }
    await page.goto('/zh/cars/', { waitUntil: 'domcontentloaded' });
    await page.locator('a[data-analytics-vehicle]:visible').first().waitFor();
    await page.getByTestId('tracking-consent-banner').waitFor();
    assert.equal(actions.length, 0);
    staff = await browser.newContext({ baseURL: origin });
    const traffic = '/api/v1/admin/analytics/traffic?period=today&pageSize=100';
    assert.equal((await staff.request.get(traffic, { maxRedirects: 0 })).status(), 401);
    const account = JSON.parse(readFileSync(resolve(__dirname, '../docs/private/local-preview/admin-account.json'), 'utf8'));
    assert.equal(account.database, 'hd_local_preview');
    assert.equal(account.role, 'admin');
    const login = await staff.request.post('/api/auth/sign-in/email', {
      headers: { Origin: origin }, data: { email: account.email, password: account.password }, maxRedirects: 0,
    });
    assert.equal(login.status(), 200, 'Local admin login');
    async function vehicleCount(id) {
      const response = await staff.request.get(traffic, { maxRedirects: 0 });
      assert.equal(response.status(), 200, 'Traffic report');
      const { data } = await response.json();
      assert.ok(data.quality.contacts.configured, 'Local anonymous contact collection must be enabled');
      const row = data.ranking.items.find(item => item.vehicleId === id);
      return row?.whatsappClicks ?? 0;
    }
    for (const channel of ['whatsapp', 'telegram']) {
      if (channel === 'telegram') {
        assert.equal(sessionBatches, 0, 'Default visits must work without a browser session');
        acceptClicked = true;
        await page.getByTestId('tracking-consent-banner').getByRole('button').click();
        await page.getByTestId('tracking-consent-banner').waitFor({ state: 'hidden' });
      }
      const link = page.locator('a[data-analytics-contact="' + channel + '"][data-analytics-contact-vehicle]:visible').first();
      const vehicleId = await link.getAttribute('data-analytics-contact-vehicle');
      const destination = new URL(await link.getAttribute('href'));
      assert.ok(classifications[channel].has(destination.hostname), 'Contact link must navigate directly');
      simulateFailure = channel === 'telegram';
      const before = !simulateFailure ? await vehicleCount(vehicleId) : null;
      const [response, popup] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === counter),
        context.waitForEvent('page'),
        link.click(),
      ]);
      assert.ok(simulateFailure ? response.status() === 503 : response.ok(), 'Local counter response ' + response.status());
      await popup.waitForLoadState('domcontentloaded');
      assert.equal(externalDestinations.at(-1), destination.hostname);
      await popup.close();
      const event = actions.at(-1);
      assert.equal(event.method, 'POST');
      assert.deepEqual(event.body, { channel, vehicleId });
      for (const name of ['cookie', 'authorization', 'referer']) assert.equal(event.headers[name], undefined);
      if (before !== null) assert.equal(await vehicleCount(vehicleId), before + 1, 'Vehicle WhatsApp counter delta');
    }
    // Allow queued session events (and accidental retries) to reach the interceptor.
    await page.waitForTimeout(1500);
    assert.equal(actions.length, 2);
    assert.equal(externalDestinations.length, 2);
    assert.deepEqual(unexpected, []);
    assert.ok(sessionBatches > 0, 'One explicit Accept should enable the local session analytics fixture');
    const dashboard = await staff.newPage();
    const problems = [];
    dashboard.on('pageerror', error => problems.push(error.name + ': ' + error.message.split('\n')[0]));
    dashboard.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400 || path === '/api/v1/admin/analytics/traffic') problems.push(response.status() + ' ' + path);
    });
    const overview = dashboard.getByRole('region', { name: '联系点击概览' });
    await dashboard.goto('/admin/analytics/', { waitUntil: 'domcontentloaded' });
    try {
      await overview.waitFor({ timeout: 15_000 });
    } catch (error) {
      const where = new URL(dashboard.url()).pathname;
      throw new Error('Admin contact dashboard ' + where + ': ' + problems.join(', ') + '; ' + error.message);
    }
    await dashboard.getByRole('region', { name: '官网访问量概览' }).waitFor();
    console.log('Three locale policies, pre-Accept WhatsApp +1, single Accept enables sessions, direct Telegram on counter failure, visit metric visible, zero Meta requests.');
  } finally {
    if (staff) await staff.request.post('/api/auth/sign-out', { headers: { Origin: origin }, data: {}, maxRedirects: 0 }).catch(() => {});
    await browser.close();
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
