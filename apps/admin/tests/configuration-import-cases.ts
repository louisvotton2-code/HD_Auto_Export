import { expect, test } from '@playwright/test';
import { configurationImportExample, ConfigurationImportPreviewRequestSchema, ConfigurationImportSaveRequestSchema, parseConfigurationImportJson } from '@hd/contracts/admin';
import { envelope, error, installApi, localization, reply, translationBundle, vehicle } from './api-fixture';
import { tab } from './ui-helpers';

const id = '30000000-0000-4000-8000-000000000020';
const path = `/api/v1/admin/vehicles/${id}/configuration-import`;
const token = '1794756829000.' + 'a'.repeat(64);
const json = JSON.stringify(configurationImportExample, null, 2);

test('configuration import uploads, shows trilingual changes and binds one save to reviewed JSON', async ({ page }) => {
  const item = { ...vehicle(), id };
  const saved = localization(item);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  const previews: string[] = [];
  let writes = 0;
  await page.route(`**${path}/preview`, route => {
    const input = ConfigurationImportPreviewRequestSchema.parse(route.request().postDataJSON());
    expect(input).toMatchObject({ version: item.version, localizationRevision: saved.revision });
    const document = parseConfigurationImportJson(input.json);
    previews.push(input.json);
    return reply(route, envelope({
      version: input.version, localizationRevision: input.localizationRevision, previewToken: token,
      changes: [{ path: 'facts.powertrain', before: 'hev', after: 'petrol' },
        { path: 'items.0.name.en', before: null, after: document.items?.[0]?.name.en }],
      itemOrder: { before: [], after: [document.items![0]!.id] },
    }));
  });
  await page.route(`**${path}`, route => {
    expect(route.request().method()).toBe('PUT');
    const input = ConfigurationImportSaveRequestSchema.parse(route.request().postDataJSON());
    expect(input).toMatchObject({ json: previews[1], previewToken: token, version: 1, localizationRevision: 0 });
    const document = parseConfigurationImportJson(input.json);
    expect(document.items?.[0]?.name.en).toBe('Number of gears');
    writes++;
    item.version++;
    item.draft.facts.powertrain = 'petrol';
    item.draft.configuration = { version: 1, items: document.items!.map(row => ({ name: row.name.zh, value: row.value.zh })) };
    saved.revision++;
    saved.vehicleVersion = item.version;
    return reply(route, envelope(translationBundle(item, saved)));
  });

  await page.goto(`/admin/vehicles/${id}`); await tab(page, '车辆配置');
  const input = page.getByLabel('三语 JSON', { exact: true });
  const preview = page.getByRole('button', { name: '预览导入变更' });
  const save = page.getByRole('button', { name: '确认并保存三语资料' });
  await expect(preview).toBeDisabled();
  await expect(input).toBeEnabled();
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({
    name: 'vehicle.json', mimeType: 'application/json', buffer: Buffer.from(json),
  });
  await expect(input).toHaveValue(json);
  await preview.click();
  await expect(page.getByRole('cell', { name: '汽油', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Gears', exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: /配置项目 · 1 项/ }).click();
  await page.getByLabel('第 1 项名称 · 英文', { exact: true }).fill('Number of gears');
  await expect(save).toHaveCount(0);
  await preview.click();
  await expect(page.getByRole('cell', { name: 'Number of gears', exact: true })).toBeVisible();
  await save.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(input).toHaveValue('');
  expect(previews).toHaveLength(2);
  expect(writes).toBe(1);
  expect(api.saves).toEqual([]);
  expect(api.bundleSaves).toEqual([]);
  expect(api.previewConfirmations).toEqual([]);
  expect(api.translationPlans).toEqual([]);
  expect(api.translationGenerations).toEqual([]);
});

test('configuration import reports exact invalid paths and preserves pasted input after stale preview', async ({ page }) => {
  const item = { ...vehicle(), id }; const api = await installApi(page, { items: [item] });
  let previews = 0; let saves = 0;
  await page.route(`**${path}/preview`, route => {
    previews++;
    return reply(route, envelope({ version: item.version, localizationRevision: 0, previewToken: token,
      changes: [{ path: 'content.title.en', before: null, after: 'Example vehicle' }], itemOrder: null }));
  });
  await page.route(`**${path}`, route => { saves++; return reply(route, error('VERSION_CONFLICT'), 409); });
  await page.goto(`/admin/vehicles/${id}`); await tab(page, '车辆配置');
  const source = page.getByLabel('三语 JSON', { exact: true });
  const preview = page.getByRole('button', { name: '预览导入变更' });
  const save = page.getByRole('button', { name: '确认并保存三语资料' });
  const duplicate = json.replace('"name": {', '"name": { "zh": "重复项",');
  await source.fill(duplicate); await preview.click();
  await expect(page.getByText('items[0].name.zh', { exact: true })).toBeVisible();
  expect(previews).toBe(0);
  await source.fill(json); await preview.click();
  await expect(save).toBeEnabled(); await save.click();
  await expect(page.getByText('预览已过期或草稿版本已变，请读取最新版本后重新预览。', { exact: true })).toBeVisible();
  await expect(source).toHaveValue(json);
  await expect(save).toHaveCount(0);
  expect(previews).toBe(1); expect(saves).toBe(1); expect(api.saves).toEqual([]);
});

test('configuration import checks the current draft after a lost save response without resubmitting', async ({ page }) => {
  const item = { ...vehicle(), id }; const saved = localization(item);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  let saves = 0;
  await page.route(`**${path}/preview`, route => reply(route, envelope({ version: item.version, localizationRevision: saved.revision, previewToken: token,
    changes: item.version === 1 ? [{ path: 'content.title.en', before: null, after: 'Example vehicle' }] : [], itemOrder: null })));
  await page.route(`**${path}`, route => {
    saves++; item.version++; saved.revision++; saved.vehicleVersion = item.version;
    return route.abort('failed');
  });
  await page.goto(`/admin/vehicles/${id}`); await tab(page, '车辆配置');
  const source = page.getByLabel('三语 JSON', { exact: true });
  const preview = page.getByRole('button', { name: '预览导入变更' });
  const save = page.getByRole('button', { name: '确认并保存三语资料' });
  await source.fill(json); await preview.click(); await save.click();
  await expect(page.getByText('保存结果待核对', { exact: true })).toBeVisible();
  await expect(source).toHaveValue(json);
  await expect(save).toBeDisabled();
  await expect(page.getByText('三语资料已保存到草稿。', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '读取最新草稿版本' }).click();
  await expect(page.getByText('已读取当前草稿。请重新预览并核对导入差异。', { exact: true })).toBeVisible();
  await preview.click();
  await expect(page.getByText('没有文字内容发生变化', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  expect(saves).toBe(1);
  expect(api.previewConfirmations).toEqual([]);
  expect(api.translationGenerations).toEqual([]);
});
