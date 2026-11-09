/** Visual fixture checks only: no business data or translation provider is contacted. */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { installApi, vehicle } from './api-fixture';
import { notes } from './ui-helpers';

const directory = '/private/tmp/hd-ad-brand-evidence';
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function contrastRatio(foreground: string, background: string) {
  const luminance = (value: string) => {
    const channels = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(channel => {
      const s = channel / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const a = luminance(foreground); const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, name: string) {
  await mkdir(directory, { recursive: true });
  await fits(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true, animations: 'disabled' });
}
async function focusUncovered(locator: Locator) {
  await locator.focus(); await expect(locator).toBeFocused();
  await expect.poll(() => locator.evaluate(node => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && !!hit && (node === hit || node.contains(hit));
  }), { message: 'Focused control stays inside the viewport and is not covered by a fixed element' }).toBe(true);
}
async function primaryContrast(locator: Locator) {
  await expect(locator).toBeEnabled();
  const readColors = () => locator.evaluate(node => { const css = getComputedStyle(node); return { foreground: css.color, background: css.backgroundColor }; });
  await expect.poll(async () => {
    const colors = await readColors();
    // An enabled button can still be transitioning out of the disabled translucent palette.
    if ([colors.foreground, colors.background].some(value => value.startsWith('rgba('))) return 0;
    return contrastRatio(colors.foreground, colors.background);
  }, { message: 'Enabled primary button text meets 4.5:1 after its color transition settles' }).toBeGreaterThanOrEqual(4.5);
  return readColors();
}

test('brand login matches the public logo and fits desktop 900px and 320px with visible focus', async ({ page }) => {
  const [adminLogo, publicLogo] = await Promise.all([
    readFile(new URL('../public/brand/hd-auto-logo.webp', import.meta.url)),
    readFile(new URL('../../web/public/brand/hd-auto-logo.webp', import.meta.url)),
  ]);
  expect(sha(adminLogo)).toBe(sha(publicLogo));
  expect(sha(adminLogo)).toBe('ff10157d783b86d3326dc089c564beaa24d1b54b2ba0b10d64360eed8fbe4d16');
  await installApi(page, { authenticated: false });
  await page.goto('/admin/vehicles');
  const delivered = await page.request.get('/admin/brand/hd-auto-logo.webp');
  expect(delivered.status()).toBe(200); expect(sha(await delivered.body())).toBe(sha(publicLogo));
  const palette: unknown[] = [];
  for (const width of [1440, 900, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await expect(page.getByRole('heading', { name: '登录员工工作台' })).toBeVisible();
    if (width <= 900) await expect(page.locator('.login-story')).toBeHidden();
    await expect.poll(() => page.locator('img.brand-logo:visible').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)) ).toBe(true);
    await focusUncovered(page.getByLabel('账号或工作邮箱'));
    await focusUncovered(page.getByLabel('密码', { exact: true }));
    const login = page.getByRole('button', { name: /登录工作台$/ });
    await focusUncovered(login); palette.push({ width, ...(await primaryContrast(login)) });
    await capture(page, `login-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The adjacent brand text supplies the name; a repeated image alt must not duplicate it.
  await expect.soft(page.locator('.brand-mark:visible').first()).toHaveAccessibleName(/^HD Auto Export\s*员工工作台$/);
  await writeFile(`${directory}/palette-and-logo.json`, JSON.stringify({ logoSha256: sha(publicLogo), primary: palette }, null, 2));
});

test('brand employee list and mobile navigation keep the logo and focused links unobscured', async ({ page }) => {
  const item = vehicle(); item.draft.media = [];
  await installApi(page, { items: [item] });
  await page.goto('/admin/vehicles');
  await expect(page.getByRole('heading', { name: '车辆管理', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-sidebar img.brand-logo')).toHaveJSProperty('complete', true);
  await capture(page, 'employee-list-1440');
  await page.setViewportSize({ width: 320, height: 844 });
  const open = page.getByRole('button', { name: '打开导航', exact: true });
  await focusUncovered(open);
  await capture(page, 'employee-list-320');
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  const drawer = page.getByRole('dialog'); await expect(drawer).toBeVisible();
  const recycle = drawer.getByRole('link', { name: '车辆回收站', exact: true });
  await focusUncovered(recycle);
  await expect(drawer.locator('img.brand-logo')).toHaveJSProperty('naturalWidth', 960);
  const close = drawer.getByRole('button', { name: /^(关闭|Close)$/ });
  await focusUncovered(close);
  const closePalette = await close.locator('.anticon-close').evaluate(icon => {
    let ancestor: Element | null = icon.parentElement;
    while (ancestor) {
      const background = getComputedStyle(ancestor).backgroundColor;
      if (background !== 'transparent' && !background.endsWith(', 0)')) return { foreground: getComputedStyle(icon).color, background };
      ancestor = ancestor.parentElement;
    }
    throw new Error('The navigation close icon has no opaque background');
  });
  const closeContrast = contrastRatio(closePalette.foreground, closePalette.background);
  expect(closeContrast, 'Navigation close icon contrast against its header').toBeGreaterThanOrEqual(3);
  await writeFile(`${directory}/mobile-navigation-contrast.json`, JSON.stringify({ ...closePalette, ratio: closeContrast }, null, 2));
  await capture(page, 'mobile-navigation-320');
  await close.click();
  await expect(drawer).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await recycle.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '车辆回收站', exact: true })).toBeVisible();
  await fits(page);
});

test('brand editor save controls retain contrast focus and feedback on desktop and mobile', async ({ page }) => {
  const item = vehicle(); item.draft.media = [];
  const api = await installApi(page, { items: [item] });
  await page.goto(`/admin/vehicles/${item.id}`);
  await expect(page.getByLabel('标题原文', { exact: true })).toBeVisible();
  await capture(page, 'editor-basics-1440');
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    const input = await notes(page); await input.fill(`黑金视觉合成备注 ${width}`);
    await focusUncovered(input);
    const save = page.getByRole('button', { name: /保存草稿$/ });
    await primaryContrast(save); await focusUncovered(save);
    await save.click();
    await expect(page.locator('.ant-message-success').filter({ hasText: '草稿已保存' }).last()).toBeVisible();
    await expect(page.locator('.ant-alert-success').filter({ hasText: '草稿已保存' })).toBeVisible();
    await capture(page, `editor-save-toast-${width}`);
  }
  expect(api.saves).toHaveLength(2);
});
