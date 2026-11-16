import { expect, test } from '@playwright/test';
import { configurationImportExample, ConfigurationImportPreviewRequestSchema, ConfigurationImportSaveRequestSchema, parseConfigurationImportJson, vehicleConfigurationItemId, type DisplayField, type TranslatableField } from '@hd/contracts/admin';
import { envelope, error, installApi, localization, reply, translationBundle, vehicle } from './api-fixture';
import { tab } from './ui-helpers';

const id = '30000000-0000-4000-8000-000000000020';
const path = `/api/v1/admin/vehicles/${id}/configuration-import`;
const token = '1794756829000.' + 'a'.repeat(64);
const json = JSON.stringify({ ...configurationImportExample,
  items: configurationImportExample.items?.map(({ name, value }) => ({ name, value })),
}, null, 2);

test('configuration import uploads, shows trilingual changes and binds one save to reviewed JSON', async ({ page }) => {
  const item = { ...vehicle(), id };
  item.draft.configuration = { version: 1, items: [{ name: '旧配置项', value: '8' }] };
  const model = { ref: 'model', text: { zh: '合成车型', en: 'Synthetic model', ru: 'Тестовая модель' } };
  const upload = JSON.stringify({ ...JSON.parse(json), display: [model] }, null, 2);
  const makeField = (ref: string, text: Record<'zh' | 'en' | 'ru', string>): DisplayField => ({
    ref, sourceText: text.zh, sourceLanguage: 'zh', sourceVersion: 1, sourceHash: 'a'.repeat(64),
    translations: { zh: null, en: null, ru: null },
  });
  const translations = (text: Record<'zh' | 'en' | 'ru', string>): TranslatableField['translations'] => {
    const entry = (text: string) => ({ text, kind: 'human' as const, reviewStatus: 'pending' as const,
      sourceVersion: 1, humanEditVersion: 1, engineVersion: null });
    return { zh: entry(text.zh), en: entry(text.en), ru: entry(text.ru) };
  };
  const saved = localization(item, [makeField(model.ref, model.text)]);
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
        { path: `items.${document.items![0]!.id}.name.en`, before: null, after: document.items?.[0]?.name.en }],
      itemOrder: { before: [vehicleConfigurationItemId('旧配置项')], after: [document.items![0]!.id] },
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
    for (const key of ['title', 'description'] as const) item.draft.content[key].translations = translations(document.content![key]!);
    const { id, name } = document.items![0]!;
    saved.data.fields = [
      { ...makeField(model.ref, model.text), translations: translations(model.text) },
      { ...makeField(`configuration.${id}.name`, name), translations: translations(name) },
    ];
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
    name: 'vehicle.json', mimeType: 'application/json', buffer: Buffer.from(upload),
  });
  await expect(input).toHaveValue(upload);
  await page.getByRole('button', { name: '下一步：价格与内部信息' }).click();
  await expect(page.getByText('请先保存或清除当前三语资料，再继续。', { exact: true })).toBeVisible();
  await preview.click();
  const pending = page.getByRole('region', { name: '待保存的三语资料' });
  const persisted = page.getByRole('region', { name: '已保存的三语资料' });
  await expect(pending.getByRole('columnheader')).toHaveText(['字段', '中文', '英文', '俄文']);
  await expect(page.getByRole('alert').filter({ hasText: '本次将移除 1 项配置' })).toContainText('旧配置项');
  await expect(pending.getByRole('cell', { name: '汽油', exact: true })).toBeVisible();
  await expect(pending.getByRole('cell', { name: 'Gears', exact: true })).toBeVisible();
  await expect(pending.getByRole('row', { name: '挡位数 · 内容 8 8 8' })).toBeVisible();
  await expect(pending.getByRole('row', { name: /车辆标题.*Example vehicle.*Пример автомобиля/ })).toBeVisible();
  await expect(pending.getByRole('row', { name: /车况描述.*Condition is subject to inspection/ })).toBeVisible();
  await expect(pending.getByRole('row', { name: /车型名称.*Synthetic model.*Тестовая модель/ })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: /配置项目 · 1 项/ }).click();
  await page.getByLabel('第 1 项名称 · 英文', { exact: true }).fill('Number of gears');
  await expect(save).toHaveCount(0);
  await expect(pending).toHaveCount(0);
  await preview.click();
  await expect(pending.getByRole('cell', { name: 'Number of gears', exact: true })).toBeVisible();
  await save.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(input).toHaveValue('');
  await expect(persisted.getByRole('columnheader')).toHaveText(['字段', '中文', '英文', '俄文']);
  await expect(persisted.getByRole('row', { name: /挡位数 · 名称.*Number of gears.*Количество передач/ })).toBeVisible();
  await expect(persisted.getByRole('row', { name: '挡位数 · 内容 8 8 8' })).toBeVisible();
  await expect(pending).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 844 });
  await page.reload(); await tab(page, '车辆配置');
  await expect(persisted.getByRole('row', { name: /挡位数 · 名称.*Number of gears/ })).toBeVisible();
  await expect(persisted.getByRole('row', { name: /车辆标题.*Example vehicle.*Пример автомобиля/ })).toBeVisible();
  await expect(persisted.getByRole('row', { name: /车况描述.*Condition is subject to inspection/ })).toBeVisible();
  await expect(persisted.getByRole('row', { name: /车型名称.*Synthetic model.*Тестовая модель/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(previews).toHaveLength(2);
  expect(writes).toBe(1);
  expect(api.saves).toEqual([]);
  expect(api.bundleSaves).toEqual([]);
  expect(api.previewConfirmations).toEqual([]);
  expect(api.translationPlans).toEqual([]);
  expect(api.translationGenerations).toEqual([]);
});

test('configuration import copies the saved vehicle context and offers one trilingual editor on mobile', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { (window as unknown as { configurationPrompt: string }).configurationPrompt = text; },
    } });
  });
  const item = { ...vehicle(), id };
  item.draft.content.title.sourceText = '合成标题';
  item.draft.content.description.sourceText = '合成车况';
  item.draft.internal.notes = '仅员工可见的模拟备注';
  item.draft.configuration = { version: 1, items: [{ name: '挡位数', value: '8' }] };
  const field = { ref: 'model', sourceLanguage: 'zh', sourceText: '合成车型', sourceVersion: 1, sourceHash: 'a'.repeat(64), translations: { zh: null, en: null, ru: null } };
  const saved = localization(item, [field]);
  const api = await installApi(page, { items: [item], localizations: [saved] });
  const bundlePath = `**/api/v1/admin/vehicles/${id}/translation-bundle`;
  await page.route(bundlePath, route => reply(route, error('SERVICE_UNAVAILABLE'), 503));
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto(`/admin/vehicles/${id}`);
  expect(api.bundleReads).toEqual([]);
  await tab(page, '车辆配置');
  const copy = page.getByRole('button', { name: '复制三语 JSON 提示词' });
  await expect(copy).toBeDisabled();
  const retry = page.getByRole('button', { name: '重新读取公开字段' });
  await expect(retry).toBeVisible();
  await page.unroute(bundlePath);
  await retry.click();
  await expect(copy).toBeEnabled();
  await copy.click();
  const prompt = await page.evaluate(() => (window as unknown as { configurationPrompt: string }).configurationPrompt);
  expect(prompt).toContain('先联网核实对应车型的技术参数和装备配置');
  expect(prompt).toContain('确定的配置事实需要同款官方资料支持');
  expect(prompt).toContain('确认前停止输出 JSON');
  expect(prompt).toContain('vehicle-configuration.json，并提供下载');
  const context = JSON.parse(prompt.split('以下是待检索车辆基础资料：\n')[1]!);
  expect(context).toMatchObject({ 中文标题: '合成标题', 车况描述: '合成车况' });
  expect(prompt).toContain('合成车型');
  expect(prompt).not.toContain('仅员工可见的模拟备注');
  await expect(page.getByText(/编辑中文配置|标题译文|描述译文|车辆展示资料|补充代系与驱动形式/)).toHaveCount(0);
  await page.getByText('查看 AI 提示词', { exact: true }).click();
  await expect(page.getByLabel('三语 JSON 提示词', { exact: true })).toHaveValue(prompt);
  await expect(page.getByRole('button', { name: '复制文案补译提示词' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(api.bundleSaves).toEqual([]);
  expect(api.translationGenerations).toEqual([]);
  await tab(page, '基础资料');
  item.version++;
  await tab(page, '车辆配置');
  await expect(page.getByText('草稿版本已变化。请先读取最新草稿。')).toBeVisible();
  await expect(copy).toBeDisabled();
  await page.getByRole('button', { name: '读取最新草稿版本' }).click();
  await expect(copy).toBeEnabled();
});

test('configuration import displays power in the comparison without unrelated warnings and blocks conflicting powertrain', async ({ page }) => {
  const item = { ...vehicle(), id };
  item.draft.facts.engineCc = 1800;
  item.draft.facts.powertrain = 'petrol';
  item.draft.configuration = { version: 1, items: [{ name: '动力类型', value: '汽油' }] };
  await installApi(page, { items: [item] });
  await page.route(`**${path}/preview`, route => {
    const input = parseConfigurationImportJson(route.request().postDataJSON().json);
    return reply(route, envelope({ version: item.version, localizationRevision: 0, previewToken: token,
      changes: [{ path: 'facts.powertrain', before: 'hev', after: input.facts?.powertrain }], itemOrder: null,
      warnings: input.items?.[1]?.value.zh === '1989' ? [{ path: 'json.items.1.value', code: 'RETAINED_CONFIRMED_VALUE', retained: '1800', submitted: '1989' }] : [],
    }));
  });
  const items = [
    { name: { zh: '动力类型', ru: 'Тип двигателя', en: 'Powertrain' }, value: { zh: '汽油', ru: 'Бензин', en: 'Gasoline' } },
    { name: { zh: '排量(cc)', ru: 'Объём(cc)', en: 'Displacement(cc)' }, value: { zh: '1989', ru: '1989', en: '1989' } },
    { name: { zh: '发动机最大功率(kW)', ru: 'Мощность двигателя(kW)', en: 'Maximum engine power(kW)' }, value: { zh: '110', ru: '110', en: '110' } },
  ];
  await page.goto(`/admin/vehicles/${id}`); await tab(page, '车辆配置');
  const input = page.getByLabel('三语 JSON', { exact: true });
  const preview = page.getByRole('button', { name: '预览导入变更' });
  const confirm = page.getByRole('button', { name: '确认并保存三语资料' });
  await input.fill(JSON.stringify({ version: 1, items, facts: { powertrain: 'bev' } }));
  await preview.click();
  await expect(page.getByText('配置项目中的动力类型与车辆动力类型不一致')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '部分配置与详细车辆信息有差异' })).toContainText('详细车辆信息采用已确认的「1800」。');
  await expect(page.getByRole('row', { name: /发动机最大功率\(kW\) · 名称.*Maximum engine power/ })).toBeVisible();
  await expect(page.getByText(/独立(?:功率字段|车辆参数)保留/)).toHaveCount(0);
  await expect(confirm).toBeDisabled();
  await input.fill(JSON.stringify({ version: 1, facts: { powertrain: 'bev' } }));
  await preview.click();
  await expect(page.getByText('配置项目中的动力类型与车辆动力类型不一致')).toBeVisible();
  await expect(confirm).toBeDisabled();
  const invalidUnit = { zh: '1989 L', ru: '1989 L', en: '1989 L' };
  await input.fill(JSON.stringify({ version: 1, items: [items[0], { ...items[1], value: invalidUnit }], facts: { powertrain: 'petrol' } }));
  await preview.click();
  await expect(page.getByText('请修正标准参数并重新预览')).toBeVisible();
  await expect(confirm).toBeDisabled();
  await input.fill(JSON.stringify({ version: 1, items, facts: { powertrain: 'petrol' } }));
  await preview.click();
  await expect(confirm).toBeEnabled();
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
