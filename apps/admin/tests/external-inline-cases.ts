import { expect, test, type Page } from '@playwright/test';
import { makeExternalAdminFixture } from '@hd/contracts/fixtures';
import { SaveExternalOverridesSchema, type ExternalListing, type SaveExternalOverrides } from '@hd/contracts/admin';
import { envelope, error, installApi, reply } from './api-fixture';

const root = '/api/v1/admin/external';
const ui = '/admin/external-sources';
const locales = ['zh', 'en', 'ru'] as const;
const labels = { zh: '中文', en: '英文', ru: '俄文' };
const fields = ['title', 'model', 'description'] as const;
const fieldLabels = { title: '标题', model: '车型', description: '描述' };

async function openEditor(page: Page, listing: ExternalListing) {
  await page.route(`**${root}/listings/${listing.id}?*`, route => reply(route, envelope(listing)));
  await page.goto(`${ui}/listings/${listing.id}`);
  await page.getByRole('button', { name: '人工修订', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: '品牌名称', exact: true })).toBeEnabled();
  return dialog;
}

function textLabel(field: typeof fields[number], locale: typeof locales[number]) {
  return `${fieldLabels[field]} · ${labels[locale]}人工文案`;
}

test('external inline editor expands every fact and all nine texts without changing untouched overrides', async ({ page }) => {
  const { listing } = makeExternalAdminFixture();
  await installApi(page);
  listing.overrides.facts = { modelYear: null, engineCc: 1999 };
  listing.overrides.text = [{ field: 'description', locale: 'ru', sourceHash: 'd'.repeat(64), text: ' Сохранить прежний текст ' }];
  const writes: SaveExternalOverrides[] = [];
  await page.route(`**${root}/listings/${listing.id}/overrides`, route => {
    const input = SaveExternalOverridesSchema.parse(route.request().postDataJSON()); writes.push(input);
    return reply(route, envelope({ id: listing.id, version: listing.version + 1, state: 'published' }));
  });
  const dialog = await openEditor(page, listing);
  await expect(dialog.getByRole('combobox', { name: '事实字段' })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: '译文修订字段' })).toHaveCount(0);
  for (const label of ['品牌', '车型', '配置', '代际', '年款', '车身', '里程', '生产日期', '首次登记', '登记状态', '所在地', '动力', '排量', '功率', '变速箱', '驱动']) {
    await expect(dialog.getByRole('region', { name: `${label}人工修订`, exact: true })).toBeVisible();
  }
  for (const field of fields) for (const locale of locales) await expect(dialog.getByRole('textbox', { name: textLabel(field, locale), exact: true })).toBeVisible();
  await expect(dialog.getByRole('spinbutton', { name: '年款修订值' })).toHaveValue('');
  await dialog.getByRole('textbox', { name: textLabel('title', 'en') }).fill('Human English title');
  await dialog.getByRole('button', { name: '保存修订' }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({ version: listing.version, overrides: {
    ...listing.overrides,
    text: [...listing.overrides.text, { field: 'title', locale: 'en', sourceHash: listing.sourceHashes.title, text: 'Human English title' }],
  } });
});

test('external inline editor distinguishes explicit unknown from following source and clears each language independently', async ({ page }) => {
  const { listing } = makeExternalAdminFixture();
  await installApi(page);
  listing.overrides.facts = { mileageKm: 700, modelYear: 2025 };
  listing.overrides.text = fields.flatMap(field => locales.map(locale => ({ field, locale, sourceHash: listing.sourceHashes[field]!, text: `${field} ${locale} 人工修订` })));
  const writes: SaveExternalOverrides[] = [];
  await page.route(`**${root}/listings/${listing.id}/overrides`, route => {
    writes.push(SaveExternalOverridesSchema.parse(route.request().postDataJSON()));
    return reply(route, envelope({ id: listing.id, version: listing.version + 1, state: 'published' }));
  });
  const dialog = await openEditor(page, listing);
  await dialog.getByRole('region', { name: '年款人工修订', exact: true }).getByRole('button', { name: '恢复跟随来源' }).click();
  await dialog.getByRole('region', { name: '里程人工修订', exact: true }).getByRole('button', { name: '修订为未知' }).click();
  await expect(dialog.getByRole('region', { name: '里程人工修订', exact: true })).toContainText('人工修订为未知');
  for (const locale of locales) {
    await dialog.getByRole('region', { name: textLabel('title', locale), exact: true }).getByRole('button', { name: '移除此语言的人工文案' }).click();
  }
  await dialog.getByRole('textbox', { name: textLabel('description', 'en') }).fill('');
  await dialog.getByRole('button', { name: '保存修订' }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[0].overrides.facts).toEqual({ mileageKm: null });
  expect(Object.hasOwn(writes[0].overrides.facts, 'modelYear')).toBe(false);
  expect(writes[0].overrides.text).toEqual(listing.overrides.text.filter(item => item.field !== 'title' && !(item.field === 'description' && item.locale === 'en')));
});

test('external inline conflicts compare all facts and all languages while keeping current input', async ({ page }) => {
  const { listing } = makeExternalAdminFixture();
  await installApi(page);
  const latest = structuredClone(listing);
  latest.version++;
  latest.overrides.facts = { engineCc: 2500, mileageKm: null };
  latest.overrides.text = [{ field: 'description', locale: 'ru', sourceHash: listing.sourceHashes.description!, text: 'Серверная версия' }];
  const dialog = await openEditor(page, listing);
  await page.route(`**${root}/listings/${listing.id}?*`, route => reply(route, envelope(latest)));
  await page.route(`**${root}/listings/${listing.id}/overrides`, route => reply(route, error('VERSION_CONFLICT'), 409));
  await dialog.getByRole('spinbutton', { name: '排量修订值' }).fill('2000');
  await dialog.getByRole('textbox', { name: textLabel('description', 'ru') }).fill('Мой текст');
  await dialog.getByRole('button', { name: '保存修订' }).click();
  await expect(dialog.getByText(/记录已被其他同事更新/)).toBeVisible();
  await dialog.getByRole('button', { name: '核对最新版本' }).click();
  const table = dialog.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(27);
  const engineRow = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '排量', exact: true }) });
  await expect(engineRow).toContainText('2,000 cc'); await expect(engineRow).toContainText('2,500 cc');
  const descriptionRow = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '描述 · 俄文', exact: true }) });
  await expect(descriptionRow).toContainText('Мой текст'); await expect(descriptionRow).toContainText('Серверная версия');
  await expect(dialog.getByRole('textbox', { name: textLabel('description', 'ru') })).toHaveValue('Мой текст');
  await expect(dialog.getByRole('button', { name: '保存修订' })).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('external inline missing source locks new texts but allows old overrides to be removed', async ({ page }) => {
  const { listing } = makeExternalAdminFixture();
  await installApi(page);
  listing.sourceHashes.description = null;
  listing.source!.copy.description = null;
  listing.overrides.text = [{ field: 'description', locale: 'zh', sourceHash: 'c'.repeat(64), text: '旧人工描述' }];
  const writes: SaveExternalOverrides[] = [];
  await page.route(`**${root}/listings/${listing.id}/overrides`, route => {
    writes.push(SaveExternalOverridesSchema.parse(route.request().postDataJSON()));
    return reply(route, envelope({ id: listing.id, version: listing.version + 1, state: 'published' }));
  });
  const dialog = await openEditor(page, listing);
  for (const locale of locales) await expect(dialog.getByRole('textbox', { name: textLabel('description', locale) })).toBeDisabled();
  await dialog.getByRole('region', { name: textLabel('description', 'zh'), exact: true }).getByRole('button', { name: '移除此语言的人工文案' }).click();
  await dialog.getByRole('button', { name: '保存修订' }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[0].overrides.text).toEqual([]);
});

test('external inline fact-first model edit locks all model languages', async ({ page }) => {
  const { listing } = makeExternalAdminFixture();
  await installApi(page);
  const dialog = await openEditor(page, listing);
  await dialog.getByRole('textbox', { name: '品牌名称', exact: true }).fill('新的品牌显示名');
  for (const locale of locales) await expect(dialog.getByRole('textbox', { name: textLabel('model', locale), exact: true })).toBeDisabled();
  await expect(dialog.getByText('请先保存品牌或车型事实，再核对当前车型原文。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存修订' })).toBeEnabled();
});


test('external inline withdrawn listings offer no edit or visibility override entry', async ({ page }) => {
  const { withdrawn } = makeExternalAdminFixture();
  await installApi(page);
  let writes = 0;
  await page.route(`**${root}/listings/${withdrawn.id}?*`, route => reply(route, envelope(withdrawn)));
  await page.route(`**${root}/listings/${withdrawn.id}/overrides`, route => {
    writes++;
    return reply(route, error('EXTERNAL_RESTRICTION'), 409);
  });
  await page.goto(`${ui}/listings/${withdrawn.id}`);
  await expect(page.getByRole('heading', { name: '外部挂牌详情', exact: true })).toBeVisible();
  await expect(page.getByText('来源已撤回', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '人工修订', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '从公开目录隐藏' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toBe(0);
});
