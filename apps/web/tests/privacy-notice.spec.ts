import { expect, test, type Page } from '@playwright/test';
import { getPublicPixelId } from '../src/modules/analytics/pixel-config';

const choiceKey = 'hd-auto:privacy-choice:v3';
const advertisingKey = 'hd-auto:meta-advertising:v2';
const sessionKey = 'hd-auto:analytics-session:v2';
const sessionAnalytics = process.env.ANALYTICS_V2_ENABLED !== 'false';
const pixel = getPublicPixelId(
  process.env.HD_META_PIXEL_ENABLED,
  process.env.HD_META_PIXEL_ID,
);
const pixelNotice = {
  zh: '在推广车辆页面，Facebook Pixel 会向 Meta 发送车辆浏览和联系按钮点击信息，用于衡量和优化广告。',
  en: 'On promoted vehicle pages, Facebook Pixel shares vehicle views and contact button clicks with Meta to measure and improve our ads.',
  ru: 'На страницах рекламируемых автомобилей Facebook Pixel передаёт Meta сведения о просмотрах и нажатиях на кнопки связи, чтобы мы могли оценивать и улучшать рекламу.',
};

test.beforeEach(async ({ context, baseURL }) => {
  const siteOrigin = new URL(baseURL!).origin;
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.href === 'https://t.me/HD_Auto_CN')
      return route.fulfill({ contentType: 'text/plain', body: 'Contact link intercepted locally' });
    if (url.origin !== siteOrigin) return route.abort();
    if (url.pathname.startsWith('/api/v1/analytics/')) return route.fulfill({ status: 202 });
    return route.continue();
  });
});

function capturedAnalytics(page: Page) {
  const sessions: Array<{ pageType: string; sessionId: string; type: string }> = [];
  const advertising: string[] = [];
  page.on('request', (request) => {
    const { hostname, pathname } = new URL(request.url());
    if (pathname === '/api/v1/analytics/events' && request.method() === 'POST') {
      sessions.push(...request.postDataJSON().events);
    }
    if (hostname === 'connect.facebook.net' || hostname.endsWith('.facebook.net') ||
      ((hostname === 'facebook.com' || hostname.endsWith('.facebook.com')) && pathname.startsWith('/tr'))) {
      advertising.push(pathname);
    }
  });
  return { sessions, advertising };
}

const readStorage = (page: Page, key: string) => page.evaluate(name => localStorage.getItem(name), key);
const readSession = (page: Page) => page.evaluate(name => sessionStorage.getItem(name), sessionKey);

for (const [locale, width, height, notice, accept, learnMore, policyTitle, windowText] of [
  ['zh', 320, 568, '我们使用 Cookie 进行分析并改善您的体验。', '接受', '了解更多', '隐私说明', '60 分钟'],
  ['en', 1440, 900, 'We use cookies for analytics and to improve your experience.', 'Accept', 'Learn more', 'Privacy notice', '60 minutes'],
  ['ru', 320, 300, 'Мы используем файлы cookie для аналитики и улучшения вашего опыта.', 'Принять', 'Подробнее', 'Конфиденциальность', '60 минут'],
] as const) {
  test(`${locale}: the notice and seven-section privacy page are reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { sessions, advertising } = capturedAnalytics(page);
    await page.goto(`/${locale}/about/`);
    const banner = page.getByRole('region').and(page.getByTestId('tracking-consent-banner'));
    const copy = banner.getByRole('paragraph');
    await expect(banner).toHaveAccessibleName(/\S/);
    await expect(banner.getByRole('heading')).toHaveCount(0);
    const expectedNotice = pixel ? `${sessionAnalytics ? notice + ' ' : ''}${pixelNotice[locale]}` : notice;
    await expect(copy).toHaveText(`${expectedNotice} ${learnMore}`);
    await expect(page.locator('main h1')).toBeVisible();
    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, { position: 'fixed', inset: 'auto 0 0', height: '120px', zIndex: '200' });
      document.body.append(overlay);
    });
    const action = banner.getByRole('button', { name: accept, exact: true });
    const link = banner.getByRole('link', { name: learnMore, exact: true });
    const box = (await banner.boundingBox())!;
    expect(box.width).toBe(width);
    expect(box.y + box.height).toBeCloseTo(height, 0);
    expect((await copy.boundingBox())!.y).toBeGreaterThanOrEqual(box.y);
    await expect(banner.locator('button:visible')).toHaveCount(pixel ? 2 : 1);
    await expect(link).toHaveAttribute('href', `/${locale}/privacy/`);
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const control of [link, ...await banner.locator('button:visible').all()]) {
      await expect(control).toBeInViewport({ ratio: 0.98 });
      expect(await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/privacy/$`));
    const policy = page.getByTestId('privacy-page');
    await expect(policy.getByRole('heading', { level: 1, name: policyTitle })).toBeVisible();
    await expect(policy.getByRole('heading', { level: 2 })).toHaveCount(7);
    await expect(policy).toContainText(windowText);
    await expect(policy).toContainText(/\bIP\b/);
    await expect(policy).toContainText('Facebook Pixel');
    await expect(policy).toContainText('WhatsApp');
    await expect(policy).not.toContainText(/Google Analytics|Microsoft Clarity/i);
    await expect(policy.locator('a[href="https://wa.me/8618215932610"]')).toBeVisible();
    await expect(policy.locator('a[href="https://t.me/HD_Auto_CN"]')).toBeVisible();
    await expect(policy.locator('form, input, [role="switch"]')).toHaveCount(0);
    await expect(policy.getByTestId('privacy-meta-opt-in')).toHaveCount(0);
    await expect(policy.getByTestId('privacy-meta-withdraw')).toHaveCount(0);
    await expect(page.locator('footer button[aria-haspopup="dialog"]')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(await readStorage(page, choiceKey)).toBeNull();
    expect(await readSession(page)).toBeNull();
    await page.waitForTimeout(850);
    expect(sessions).toEqual([]);
    expect(advertising).toEqual([]);
  });
}

test('accept starts a session that survives reload and can be withdrawn on the privacy page', async ({ page }) => {
  test.skip(!sessionAnalytics, 'Session analytics is disabled in this configuration.');
  await page.setViewportSize({ width: 390, height: 844 });
  const { sessions, advertising } = capturedAnalytics(page);
  await page.goto('/en/about/');
  const banner = page.getByTestId('tracking-consent-banner');
  const accept = banner.getByRole('button', { name: 'Accept', exact: true });
  await expect(accept).toBeVisible();
  await page.waitForTimeout(850);
  expect(sessions).toEqual([]);
  expect(await readSession(page)).toBeNull();
  await accept.click();
  await expect(banner).toHaveCount(0);
  expect(await readStorage(page, choiceKey)).toBe('allow');
  await expect.poll(() => sessions[0]).toMatchObject({ type: 'page_view', pageType: 'about', sessionId: expect.any(String) });

  await page.reload();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => sessions.length).toBeGreaterThan(1);
  expect(sessions.at(-1)?.sessionId).toBe(sessions[0]?.sessionId);

  await page.locator('footer').getByRole('link', { name: 'Privacy notice' }).click();
  const policy = page.getByTestId('privacy-page');
  const withdraw = policy.getByTestId('privacy-analytics-withdraw');
  await expect(withdraw).toBeVisible();
  await withdraw.click();
  expect(await readStorage(page, choiceKey)).toBe('deny');
  await expect.poll(() => readSession(page)).toBeNull();
  const recorded = sessions.length;
  await page.goto('/en/buy/');
  await page.reload();
  await expect(page.getByTestId('buy-guide')).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.waitForTimeout(850);
  expect(sessions).toHaveLength(recorded);
  expect(advertising).toEqual([]);
});

test('upgrading to the SDK asks again and preserves the visitor’s existing session choice', async ({ page }) => {
  test.skip(!pixel, 'The new advertising choice applies only when Pixel is enabled.');
  await page.goto('/en/about/');
  await page.evaluate(({ choiceKey, advertisingKey }) => {
    localStorage.setItem(choiceKey, 'allow');
    localStorage.setItem(advertisingKey, 'allow');
  }, { choiceKey, advertisingKey });
  await page.reload();
  const banner = page.getByTestId('tracking-consent-banner');
  await expect(banner.getByRole('paragraph')).toHaveText(`${pixelNotice.en} Learn more`);
  await expect(banner.locator('details')).toHaveCount(0);
  await banner.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(banner).toHaveCount(0);
  expect(await readStorage(page, choiceKey)).toBe('allow');
  expect(await readStorage(page, advertisingKey)).toBe('deny');
  await page.reload();
  await expect(banner).toHaveCount(0);
});

for (const use of ['Site analytics only', 'Ad measurement only'] as const) {
  test(`saves the single purpose “${use}” across reload`, async ({ page }) => {
    test.skip(!sessionAnalytics || !pixel, 'Two optional purposes are required.');
    const { sessions, advertising } = capturedAnalytics(page);
    await page.goto('/en/about/');
    const banner = page.getByTestId('tracking-consent-banner');
    await banner.locator('summary', { hasText: 'Choose purposes' }).click();
    expect(await readStorage(page, advertisingKey)).toBeNull();
    expect(await readStorage(page, choiceKey)).toBeNull();
    await banner.getByRole('button', { name: use, exact: true }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(banner).toHaveCount(0);
    const analyticsOnly = use === 'Site analytics only';
    expect(await readStorage(page, choiceKey)).toBe(analyticsOnly ? 'allow' : 'deny');
    expect(await readStorage(page, advertisingKey)).toBe(analyticsOnly ? 'deny' : 'allow-sdk');
    if (analyticsOnly) await expect.poll(() => sessions.length).toBeGreaterThan(0);
    else expect(await readSession(page)).toBeNull();
    expect(advertising).toEqual([]);
  });
}

test('previous acknowledgement and combined choices do not grant session analytics or load advertising', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hd-auto:privacy-notice:v2', 'read');
    localStorage.setItem('hd-auto:privacy-analytics:v2', 'allow');
    localStorage.setItem('hd-auto:meta-advertising:v1', 'allow');
    localStorage.setItem('hd-auto:tracking-preferences:v1',
      JSON.stringify({ version: 1, analytics: true, advertising: true }));
  });
  const { sessions, advertising } = capturedAnalytics(page);
  await page.goto('/en/about/');
  const banner = page.getByTestId('tracking-consent-banner');
  await page.reload();
  await expect(banner.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
  await page.waitForTimeout(850);
  expect(await readStorage(page, choiceKey)).toBeNull();
  expect(await readSession(page)).toBeNull();
  expect(sessions).toEqual([]);
  expect(advertising).toEqual([]);
});

test('mobile calculator action stays accessible before acknowledgement', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/zh/calculator/russia/');
  const banner = page.getByTestId('tracking-consent-banner');
  const calculator = page.locator('.mobile-result-bar');
  await expect(banner).toBeVisible();
  await expect(calculator).toBeVisible();
  await expect.poll(async () => {
    const [action, bar] = await Promise.all([calculator.boundingBox(), banner.boundingBox()]);
    return Math.round(action!.y + action!.height - bar!.y);
  }).toBeLessThanOrEqual(0);
  await calculator.getByRole('button').click();
  await expect(banner).toBeVisible();
  expect(await readStorage(page, choiceKey)).toBeNull();
});

test('manual contact opens before a choice and after explicit decline', async ({ page }) => {
  test.skip(!sessionAnalytics && !pixel, 'No optional tracking is offered.');
  const { sessions, advertising } = capturedAnalytics(page);
  await page.goto('/en/parts/');
  const banner = page.getByTestId('tracking-consent-banner');
  await expect(banner).toBeVisible();
  const contact = page.locator('header a[aria-haspopup="dialog"]:visible');
  const dialog = page.getByRole('dialog', { name: 'Contact us' });
  await contact.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close contact window' }).click();
  expect(await readStorage(page, choiceKey)).toBeNull();

  await banner.getByRole('link', { name: 'Learn more' }).click();
  await page.getByTestId('privacy-analytics-withdraw').click();
  expect(await readStorage(page, choiceKey)).toBe(sessionAnalytics ? 'deny' : 'read');
  if (pixel) expect(await readStorage(page, advertisingKey)).toBe('deny');
  await page.goto('/en/parts/');
  await expect(banner).toHaveCount(0);
  await contact.click();
  await expect(dialog).toBeVisible();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    dialog.getByRole('link', { name: 'Telegram', exact: true }).click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url()).toBe('https://t.me/HD_Auto_CN');
  await popup.close();
  expect(await readSession(page)).toBeNull();
  expect(sessions).toEqual([]);
  expect(advertising).toEqual([]);
});
