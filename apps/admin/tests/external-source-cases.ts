import { expect, test, type Page } from '@playwright/test';
import { makeExternalAdminFixture, makeExternalCandidateFixture, makeExternalImportFixture } from '@hd/contracts/fixtures';
import { ExternalBulkVisibilityRequestSchema, ExternalTrialRequestSchema, SaveExternalOverridesSchema } from '@hd/contracts/admin';
import { envelope, error, installApi, reply, staff } from './api-fixture';

const fixture = makeExternalAdminFixture();
const { batch, records, listing, trial } = fixture;
const root = '/api/v1/admin/external';
const ui = '/admin/external-sources';

async function setup(page: Page, role: 'admin' | 'editor' = 'editor') {
  await installApi(page);
  await page.route('**/api/v1/admin/me', route => reply(route, envelope({ ...staff, role })));
  await page.route(`**${root}/status`, route => reply(route, envelope({
    catalogRevision: '1', sync: 'manual_import_only', translation: 'dry_run', lastBatch: batch, batchCharacterLimit: 100_000, accountFreeRemaining: null,
  })));
  await page.route(`**${root}/batches?*`, route => reply(route, envelope({ items: [batch], page: 1, pageSize: 25, total: 1 })));
  await page.route(`**${root}/batches/${batch.id}`, route => reply(route, envelope(batch)));
  await page.route(`**${root}/batches/${batch.id}/records?*`, route => reply(route, envelope({ items: records, page: 1, pageSize: 25, total: records.length })));
  await page.route(`**${root}/batches/${batch.id}/translation-trial`, route => reply(route, envelope(trial)));
  await page.route(`**${root}/listings/${listing.id}?*`, route => reply(route, envelope(listing)));
}

test('external batches expose source conflict and usage details to editors at mobile width', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(ui);
  await expect(page.getByRole('heading', { name: '外部车源管理' })).toBeVisible();
  await expect(page.getByText('手动导入', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入批次' })).toHaveCount(0);
  await page.getByRole('link', { name: '查看批次' }).click();
  await expect(page.getByText('30 字符', { exact: true })).toBeVisible();
  await expect(page.getByText('0 字符', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '测算试译用量' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const candidate = makeExternalCandidateFixture(3);
  await page.route(`**${root}/batches/${batch.id}/records/2`, route => reply(route, envelope({ ...records[1], candidate, rawHash: '1'.repeat(64) })));
  await page.getByRole('row').filter({ hasText: '1 项' }).getByRole('link', { name: '查看来源' }).click();
  await expect(page.getByText('来源值冲突', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '打开来源挂牌' })).toHaveAttribute('href', candidate.listingUrl);
  await expect(page.getByRole('button', { name: '读取受保护原档' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('external rejected source never promotes an unverified URL to a clickable listing', async ({ page }) => {
  await setup(page);
  const address = 'https://unverified.example.invalid/listing';
  await page.route(`**${root}/batches/${batch.id}/records/3`, route => reply(route, envelope({
    ...records[2], candidate: { ...makeExternalCandidateFixture(3), listingUrl: address }, rawHash: '1'.repeat(64),
  })));
  await page.goto(`${ui}/batches/${batch.id}/records/3`);
  await expect(page.getByText(`未验证来源地址 ${address}`)).toBeVisible();
  await expect(page.getByRole('link', { name: '打开来源挂牌' })).toHaveCount(0);
});

test('external override rejects stale versions and replays uncertain writes with the same body and key', async ({ page }) => {
  await setup(page);
  let version = listing.version;
  await page.route(`**${root}/listings/${listing.id}?*`, route => reply(route, envelope({ ...listing, version })));
  const attempts: { body: string | null; key: string | undefined }[] = [];
  await page.route(`**${root}/listings/${listing.id}/overrides`, async route => {
    const req = route.request();
    const input = SaveExternalOverridesSchema.parse(req.postDataJSON());
    expect(input).toEqual({
      version,
      overrides: {
        ...listing.overrides,
        facts: { modelYear: 2025 },
        text: [{ field: 'title', locale: 'zh', sourceHash: listing.sourceHashes.title, text: '员工修订标题' }],
      },
    });
    attempts.push({ body: req.postData(), key: req.headers()['idempotency-key'] });
    if (attempts.length === 1) {
      version++;
      return reply(route, error('VERSION_CONFLICT'), 409);
    }
    if (attempts.length === 2) return route.abort('failed');
    return reply(route, envelope({ id: listing.id, version: version + 1, state: 'published' }));
  });
  await page.goto(`${ui}/listings/${listing.id}`);
  await page.getByRole('button', { name: '人工修订' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: '修订值' }).fill('2025');
  await dialog.getByRole('textbox', { name: '人工译文' }).fill('员工修订标题');
  await dialog.getByRole('button', { name: '保存修订' }).click();
  await expect(dialog.getByText(/记录已被其他同事更新/)).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '人工译文' })).toHaveValue('员工修订标题');
  await expect(dialog.getByRole('button', { name: '保存修订' })).toBeDisabled();
  await dialog.getByRole('button', { name: '核对最新版本' }).click();
  await expect(dialog.getByText(/当前版本 4，本次编辑基于版本 3/)).toBeVisible();
  await dialog.getByRole('button', { name: '放弃输入并重新读取挂牌' }).click();
  await page.getByRole('button', { name: '确认放弃' }).click();
  await page.getByRole('button', { name: '人工修订' }).click();
  await dialog.getByRole('spinbutton', { name: '修订值' }).fill('2025');
  await dialog.getByRole('textbox', { name: '人工译文' }).fill('员工修订标题');
  await dialog.getByRole('button', { name: '保存修订' }).click();
  await expect(dialog.getByText('操作结果尚未确认')).toBeVisible();
  await dialog.getByRole('button', { name: '重试原请求' }).click();
  await expect(dialog).toHaveCount(0);
  expect(attempts[1].key).toBeTruthy();
  expect(attempts[2]).toEqual(attempts[1]);
});

test('external bulk visibility submits displayed versions and reports partial failure', async ({ page }) => {
  await setup(page);
  const withdrawn = { ...fixture.withdrawn, id: records[3].listingId! };
  await page.route(`**${root}/listings/${withdrawn.id}?*`, route => reply(route, envelope(withdrawn)));
  await page.route(`**${root}/listings/bulk-visibility`, async route => {
    expect(ExternalBulkVisibilityRequestSchema.parse(route.request().postDataJSON())).toEqual({
      hidden: false, items: [{ id: listing.id, version: listing.version }, { id: withdrawn.id, version: withdrawn.version }],
    });
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    return reply(route, envelope({ items: [
      { id: listing.id, status: 'unchanged', version: listing.version, state: listing.state },
      { id: withdrawn.id, status: 'failed', reason: 'EXTERNAL_RESTRICTION' },
    ] }));
  });
  await page.goto(`${ui}/batches/${batch.id}`);
  await page.getByRole('row').filter({ hasText: /查看来源.*查看当前挂牌/ }).nth(0).getByRole('checkbox').check();
  await page.getByRole('row').filter({ hasText: /查看来源.*查看当前挂牌/ }).nth(2).getByRole('checkbox').check();
  await page.getByRole('button', { name: '批量取消隐藏' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/来源已撤回 · 版本/)).toBeVisible();
  await dialog.getByRole('button', { name: '确认处理' }).click();
  await expect(page.getByText('来源已撤回或不符合展示条件')).toBeVisible();
  await expect(page.getByText('本页选中 1 条挂牌')).toBeVisible();
});

test('external model fact change must be saved separately from a new model translation', async ({ page }) => {
  await setup(page);
  await page.route(`**${root}/listings/${listing.id}/overrides`, route => {
    const payload = SaveExternalOverridesSchema.parse(route.request().postDataJSON());
    expect(payload.overrides.facts.model?.name).toBe('另一个车型名称');
    expect(payload.overrides.text).toEqual(listing.overrides.text);
    return reply(route, envelope({ id: listing.id, version: listing.version + 1, state: 'published' }));
  });
  await page.goto(`${ui}/listings/${listing.id}`);
  await page.getByRole('button', { name: '人工修订' }).click();
  const dialog = page.getByRole('dialog');
  async function chooseModel(label: string) {
    await dialog.getByRole('combobox', { name: label }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content')
      .filter({ hasText: /^车型$/ }).click({ timeout: 5000 });
  }
  await chooseModel('译文修订字段');
  await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: '人工译文' }).fill('待保存车型译文');
  await chooseModel('事实字段');
  await dialog.getByLabel('名称', { exact: true }).fill('另一个车型名称');
  await expect(dialog.getByRole('button', { name: '保存修订' })).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: '人工译文' })).toHaveValue('待保存车型译文');
  await dialog.getByRole('button', { name: '保留已保存的车型译文' }).click();
  await dialog.getByRole('button', { name: '保存修订' }).click();
  await expect(dialog).toHaveCount(0);
});

test('external admin imports a normalized batch and submits the fixed dry-run sample', async ({ page }) => {
  await setup(page, 'admin');
  const input = makeExternalImportFixture(1);
  await page.route(`**${root}/batches`, route => {
    expect(route.request().postDataJSON()).toEqual(input);
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    return reply(route, envelope(batch), 201);
  });
  await page.goto(ui);
  await page.getByRole('button', { name: '导入批次' }).click();
  await page.getByLabel('规范化批次 JSON').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
  await page.getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByText('导入完成，请查看批次结果。')).toBeVisible();
  let recorded = false;
  await page.route(`**${root}/batches/${batch.id}/translation-trial`, route => {
    if (route.request().method() === 'GET') return reply(route, envelope(recorded ? trial : null));
    expect(ExternalTrialRequestSchema.parse(route.request().postDataJSON()).vehicleIds).toEqual(trial.vehicleIds);
    recorded = true;
    return reply(route, envelope(trial));
  });
  await page.getByRole('link', { name: '查看批次' }).click();
  await page.getByRole('textbox', { name: '试译挂牌编号' }).fill(trial.vehicleIds.join('\n'));
  await page.getByRole('button', { name: '测算试译用量' }).click();
  await expect(page.getByText('已记录试译测算')).toBeVisible();
  await expect(page.getByText('0 字符', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '试译挂牌编号' })).toHaveCount(0);
});

test('external import sends a deep malformed candidate unchanged for per-row rejection', async ({ page }) => {
  await setup(page, 'admin');
  const input = makeExternalImportFixture(1);
  const deepCandidate = '['.repeat(12000) + 'null' + ']'.repeat(12000);
  const body = `{"provider":${JSON.stringify(input.provider)},"records":[${JSON.stringify(input.records[0])},{"raw":"synthetic bad row","candidate":${deepCandidate}}]}`;
  await page.route(`**${root}/batches`, route => {
    expect(route.request().postData()).toBe(body);
    return reply(route, envelope({ ...batch, counts: { total: 2, applied: 1, unchanged: 0, ignored: 0, rejected: 1 } }), 201);
  });
  await page.goto(ui);
  await page.getByRole('button', { name: '导入批次' }).click();
  await page.getByLabel('规范化批次 JSON').setInputFiles({
    name: 'synthetic-deep-row.json', mimeType: 'application/json', buffer: Buffer.from(body),
  });
  await page.getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByText('导入完成，请查看批次结果。')).toBeVisible();
});
