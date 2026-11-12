/** UI contract tests: synthetic vehicles and intercepted API responses, never operational data. */
import { expect, test, type Page } from '@playwright/test';
import type { AdminHomeSections } from '@hd/contracts/admin';
import { envelope, error, installApi, reply, vehicle } from './api-fixture';

const ids = [1, 2, 3, 4].map(value => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`);
const region = (page: Page, section = 1) => page.getByRole('region', { name: `区块 ${section}车辆排序`, exact: true });
const rows = (page: Page, section = 1) => region(page, section).locator('[data-home-order-row]');
const order = (page: Page, section = 1) => rows(page, section).evaluateAll(elements => elements.map(element => element.getAttribute('data-home-order-row')));
const handle = (page: Page, number: number) => page.getByRole('button', { name: `区块 1拖动排序 ORDER-${number}`, exact: true });
const adjust = (page: Page, number: number) => page.getByRole('button', { name: `区块 1调整顺序 ORDER-${number}`, exact: true });
const saveButton = (page: Page) => page.getByRole('button', { name: /保存首页配置$/ });

async function setup(page: Page) {
  const items = ids.map((id, index) => ({ ...vehicle(), id, stockCode: `ORDER-${index + 1}`, publicationState: 'published' as const, availability: 'available' as const }));
  await installApi(page, { items });
  const state = {
    home: { version: 3, sections: [
      { id: 'featured', title: { zh: '排序推荐', en: 'Featured', ru: 'Избранное' }, vehicleIds: ids.slice(0, 3) },
      { id: 'recent', title: { zh: '另一独立区块', en: 'Recent', ru: 'Новое' }, vehicleIds: [ids[0]!] },
    ] } as AdminHomeSections,
    puts: [] as AdminHomeSections[], mode: 'ok' as 'ok' | 'fail' | 'conflict',
  };
  await page.route('**/api/v1/admin/home/vehicle-sections', route => {
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON() as AdminHomeSections;
      state.puts.push(input);
      if (state.mode === 'fail') return reply(route, error('SERVICE_UNAVAILABLE'), 503);
      if (state.mode === 'conflict') { state.home.version = 4; return reply(route, error('VERSION_CONFLICT'), 409); }
      state.home = { ...input, version: input.version + 1 };
    }
    return reply(route, envelope(state.home));
  });
  await page.goto('/admin/home-sections');
  await expect(handle(page, 1)).toBeVisible();
  return state;
}

async function dragCoordinates(page: Page, sourceNumber: number, targetNumber: number) {
  const source = handle(page, sourceNumber);
  const target = region(page).locator(`[data-home-order-row="${ids[targetNumber - 1]}"]`);
  await source.scrollIntoViewIfNeeded(); await target.scrollIntoViewIfNeeded();
  const start = (await source.boundingBox())!; const end = (await target.boundingBox())!;
  return { x: start.x + start.width / 2, y: start.y + start.height / 2, targetY: end.y + end.height * 0.8 };
}

test('home ordering keyboard move stays local, guards navigation and saves the original version', async ({ page }) => {
  const api = await setup(page);
  await handle(page, 1).focus(); await page.keyboard.press('Space'); await page.keyboard.press('End');
  await expect(page.getByLabel('区块 1中文标题')).toBeDisabled();
  await expect(page.getByRole('button', { name: /选择车辆$/ }).first()).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect.poll(() => order(page)).toEqual([ids[1], ids[2], ids[0]]);
  await expect(handle(page, 1)).toBeFocused();
  expect(api.puts).toHaveLength(0);
  await page.getByRole('link', { name: '车辆管理', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('离开首页配置');
  await page.getByRole('button', { name: /继续编辑$/ }).click();
  await saveButton(page).click();
  await expect(saveButton(page)).toBeDisabled();
  expect(api.puts).toHaveLength(1);
  expect(api.puts[0]).toMatchObject({ version: 3, sections: [{ vehicleIds: [ids[1], ids[2], ids[0]] }, { vehicleIds: [ids[0]] }] });
  await page.reload();
  await expect.poll(() => order(page)).toEqual([ids[1], ids[2], ids[0]]);
});

test('home ordering keyboard and pointer cancellation leave a clean draft unchanged', async ({ page }) => {
  const api = await setup(page);
  await handle(page, 1).press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Escape');
  await expect.poll(() => order(page)).toEqual(ids.slice(0, 3));
  await expect(saveButton(page)).toBeDisabled();
  const point = await dragCoordinates(page, 1, 3);
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x, point.targetY, { steps: 8 });
  await expect(handle(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(ids.slice(0, 3));
  await expect(saveButton(page)).toBeDisabled();
  expect(api.puts).toHaveLength(0);
});

test('home ordering pointer drag changes only its section and can be saved', async ({ page }) => {
  const api = await setup(page);
  const point = await dragCoordinates(page, 1, 3);
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x, point.targetY, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => order(page)).toEqual([ids[1], ids[2], ids[0]]);
  await expect.poll(() => order(page, 2)).toEqual([ids[0]]);
  await saveButton(page).click();
  await expect.poll(() => api.puts.length).toBe(1);
  expect(api.puts[0]!.sections[0]!.vehicleIds).toEqual([ids[1], ids[2], ids[0]]);
});

test('home ordering exact position and top/bottom actions are usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const api = await setup(page);
  await adjust(page, 3).click();
  const modal = page.getByRole('dialog', { name: '调整区块 1车辆顺序' });
  await modal.getByRole('spinbutton', { name: '目标序号' }).fill('');
  await expect(modal.getByRole('button', { name: /移动到此位置$/ })).toBeDisabled();
  await modal.getByRole('spinbutton', { name: '目标序号' }).fill('2');
  await modal.getByRole('button', { name: /移动到此位置$/ }).click();
  await expect.poll(() => order(page)).toEqual([ids[0], ids[2], ids[1]]);
  await expect(modal).not.toBeVisible();
  await adjust(page, 3).click(); await page.getByRole('dialog').getByRole('button', { name: /置\s*顶$/ }).click();
  await expect.poll(() => order(page)).toEqual([ids[2], ids[0], ids[1]]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await adjust(page, 3).click(); await page.getByRole('dialog').getByRole('button', { name: /置\s*底$/ }).click();
  await expect.poll(() => order(page)).toEqual(ids.slice(0, 3));
  await expect(saveButton(page)).toBeDisabled();
  expect(api.puts).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('home ordering newly selected vehicle can join at the top without duplicate selection', async ({ page }) => {
  const api = await setup(page);
  await page.getByRole('button', { name: /选择车辆$/ }).first().click();
  const modal = page.getByRole('dialog', { name: '选择首页推荐车辆' });
  const candidate = modal.getByRole('row').filter({ hasText: 'ORDER-4' });
  await candidate.getByRole('button', { name: /加入顶部$/ }).click();
  await expect(candidate.getByRole('button', { name: /已加入区块$/ })).toBeDisabled();
  await modal.getByRole('button', { name: /完成选择$/ }).click();
  await expect.poll(() => order(page)).toEqual([ids[3], ...ids.slice(0, 3)]);
  expect(api.puts).toHaveLength(0);
  await saveButton(page).click();
  await expect.poll(() => api.puts.length).toBe(1);
  expect(api.puts[0]!.sections[0]!.vehicleIds).toEqual([ids[3], ...ids.slice(0, 3)]);
});

test('home ordering keeps the chosen order after a failed save and version conflict', async ({ page }) => {
  const api = await setup(page);
  await adjust(page, 3).click(); await page.getByRole('dialog').getByRole('button', { name: /置\s*顶$/ }).click();
  const expected = [ids[2], ids[0], ids[1]];
  api.mode = 'fail'; await saveButton(page).click();
  await expect(page.getByRole('alert').filter({ hasText: '服务暂时不可用' })).toBeVisible();
  await expect.poll(() => order(page)).toEqual(expected);
  api.mode = 'conflict'; await saveButton(page).click();
  await expect(page.getByText('服务端已有配置版本 4，当前编辑已保留', { exact: true })).toBeVisible();
  await expect.poll(() => order(page)).toEqual(expected);
  expect(api.puts.map(input => input.version)).toEqual([3, 3]);
  expect(api.puts.every(input => JSON.stringify(input.sections[0]!.vehicleIds) === JSON.stringify(expected))).toBe(true);
  await expect(saveButton(page)).toBeDisabled();
});

test('home ordering touch handle reorders on a narrow screen without making the page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const point = await dragCoordinates(page, 1, 3);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 12 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.targetY }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
  await expect.poll(() => order(page)).toEqual([ids[1], ids[2], ids[0]]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
