/** Layout-only contract simulations. No translator, clipboard, or operational service is contacted. */
import { expect, test, type Page } from '@playwright/test';
import { parseVehicleConfigurationJson, VEHICLE_CONFIGURATION_LIMITS } from '@hd/contracts/admin';
import { installApi, vehicle } from './api-fixture';
import { noReviewControls, openWorkspace } from './translation-test-helpers';
import { tab } from './ui-helpers';

async function capture(page: Page, name: string) {
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath(`ux11-${name}-${width}.png`), fullPage: true, animations: 'disabled' });
  }
}

test('UX11 layout long Russian workspace text stays readable at desktop and 320px without page overflow', async ({ page }) => {
  const item = { ...vehicle(), id: '61000000-0000-4000-8000-000000000011' };
  const longRussian = 'СинтетическоеОборудованиеАвтомобиля'.repeat(45);
  item.draft.content.title.sourceText = '仅用于布局验证的中文标题';
  item.draft.content.title.translations.ru = { text: longRussian, kind: 'machine', reviewStatus: 'pending', sourceVersion: item.draft.content.title.sourceVersion, humanEditVersion: 0, engineVersion: 'synthetic-layout-engine' };
  item.draft.content.description.sourceText = '仅用于布局验证的车况说明。'.repeat(30);
  item.draft.content.description.translations.ru = { text: `${longRussian}\n${longRussian}`, kind: 'human', reviewStatus: 'pending', sourceVersion: item.draft.content.description.sourceVersion, humanEditVersion: 1, engineVersion: null };
  const before = structuredClone(item.draft); const api = await installApi(page, { items: [item] }); await openWorkspace(page, item.id);
  await expect(page.getByLabel('俄文标题', { exact: true })).toHaveValue(longRussian); await noReviewControls(page);
  await capture(page, 'workspace-long-russian');
  const input = page.getByLabel('俄文描述', { exact: true }); await input.scrollIntoViewIfNeeded(); await input.focus(); await expect(input).toBeFocused();
  const rectangle = await input.boundingBox(); expect(rectangle).not.toBeNull(); expect(rectangle!.x).toBeGreaterThanOrEqual(0); expect(rectangle!.x + rectangle!.width).toBeLessThanOrEqual(320);
  expect(api.translationPlans).toEqual([]); expect(api.translationGenerations).toEqual([]); expect(api.bundleSaves).toEqual([]); expect(item.draft).toEqual(before);
});

test('UX11 layout long valid configuration example stays within desktop and 320px page with lossless preview', async ({ page }) => {
  const item = vehicle();
  const example = { version: 1, items: Array.from({ length: 4 }, (_, index) => ({
    name: `${index}合成参数${'名'.repeat(VEHICLE_CONFIGURATION_LIMITS.nameUtf16 - 5)}`,
    value: '合成资料不代表实际配置'.repeat(40),
  })) };
  const raw = JSON.stringify(example, null, 2); item.draft.configuration = parseVehicleConfigurationJson(raw);
  const api = await installApi(page, { items: [item] }); await page.goto(`/admin/vehicles/${item.id}`); await tab(page, '车辆配置');
  const input = page.getByLabel('配置内容（JSON）', { exact: true }); expect(parseVehicleConfigurationJson(await input.inputValue())).toEqual(example);
  await page.locator('.ant-collapse-header').filter({ hasText: '核对已解析的 4 项配置' }).click();
  await expect(page.getByRole('cell', { name: example.items[0]!.name, exact: true })).toBeVisible();
  await capture(page, 'configuration-long-example');
  await input.scrollIntoViewIfNeeded(); await input.focus(); await expect(input).toBeFocused();
  expect(parseVehicleConfigurationJson(await input.inputValue())).toEqual(example); expect(api.saves).toEqual([]); expect(api.creates).toEqual([]);
});
