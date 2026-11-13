import { expect, test, type Page } from '@playwright/test';
import { makeExternalAdminFixture, makeExternalCandidateFixture, makeExternalImportFixture } from '@hd/contracts/fixtures';
import { ExternalBulkVisibilityRequestSchema, ExternalTrialRequestSchema, SaveExternalOverridesSchema, type ExternalProviderStatus } from '@hd/contracts/admin';
import { envelope, error, installApi, reply, staff } from './api-fixture';
import { select } from './ui-helpers';

const fixture = makeExternalAdminFixture();
const { batch, records, listing, trial } = fixture;
const root = '/api/v1/admin/external';
const ui = '/admin/external-sources';

const providerStatus: ExternalProviderStatus = {
  provider: 'chinacarapi', worker: 'not_configured', lastBatch: null,
  lastImportAt: '2026-11-10T05:00:00.000Z', lastFetchedAt: '2026-11-09T03:00:00.000Z',
  lastSupplierUpdatedAt: '2026-11-08T01:00:00.000Z',
  account: {
    state: 'ok', checkedAt: '2026-11-11T02:00:00.000Z', plan: 'Fixture Starter',
    expiresAt: '2026-11-30T06:00:00.000Z', sources: ['dongchedi', 'che168'],
    dailyLimit: 50, remainingToday: 0,
  },
};


async function setup(page: Page, role: 'admin' | 'editor' = 'editor') {
  await installApi(page);
  await page.route('**/api/v1/admin/me', route => reply(route, envelope({ ...staff, role })));
  await page.route(`**${root}/provider-status`, route => reply(route, envelope(providerStatus)));
  await page.route(`**${root}/ingestion-status`, route => reply(route, envelope({ mode: 'fixed_once', continuous: false, latestJob: null })));
  await page.route(`**${root}/listings/overview*`, route => reply(route, envelope({
    total: 200, published: 170, hidden: 20, withdrawn: 10, platforms: ['dongchedi', 'che168'],
    makes: [{ id: 'toyota', name: '丰田' }], models: new URL(route.request().url()).searchParams.has('make')
      ? [{ id: 'synthetic-r1', name: '示例 R1' }] : [], years: [2025, 2024],
  })));
  await page.route(`**${root}/listings?*`, route => reply(route, envelope({ items: [], page: 1, pageSize: 25, total: 0 })));
  await page.route(`**${root}/status`, route => reply(route, envelope({
    catalogRevision: '1', sync: 'manual_import_only', translation: 'dry_run', lastBatch: batch, batchCharacterLimit: 100_000, accountFreeRemaining: null,
  })));
  await page.route(`**${root}/batches?*`, route => reply(route, envelope({ items: [batch], page: 1, pageSize: 25, total: 1 })));
  await page.route(`**${root}/batches/${batch.id}`, route => reply(route, envelope(batch)));
  await page.route(`**${root}/batches/${batch.id}/records?*`, route => reply(route, envelope({ items: records, page: 1, pageSize: 25, total: records.length })));
  await page.route(`**${root}/batches/${batch.id}/translation-trial`, route => reply(route, envelope(trial)));
  await page.route(`**${root}/listings/${listing.id}?*`, route => reply(route, envelope(listing)));
}

test('external provider status keeps account probe, local import and supplier timestamps distinct', async ({ page }) => {
  await setup(page, 'admin');
  await page.setViewportSize({ width: 320, height: 850 });
  let reads = 0;
  await page.route(`**${root}/provider-status`, route => reply(route, envelope(++reads === 1 ? providerStatus : {
    ...providerStatus, lastSupplierUpdatedAt: null,
    account: {
      state: 'not_configured', checkedAt: null, plan: null, expiresAt: null, sources: [],
      dailyLimit: null, remainingToday: null,
    },
  })));
  await page.goto(ui);
  await expect(page.getByRole('heading', { name: '三方 API 状态' })).toBeVisible();
  await expect(page.getByText('连接正常', { exact: true })).toBeVisible();
  await expect(page.getByText('Fixture Starter', { exact: true })).toBeVisible();
  for (const value of ['懂车帝', '车168', '0']) await expect(page.getByText(value, { exact: true })).toBeVisible();
  for (const time of ['11/11 10:00', '11/30 14:00', '11/10 13:00', '11/9 11:00', '11/8 09:00']) {
    await expect(page.getByText(new RegExp(time))).toBeVisible();
  }
  await expect(page.getByText('持续调度关闭', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入批次' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '测算试译用量' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '历史导入批次' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: '刷新状态' }).click();
  await expect(page.getByText('未配置', { exact: true })).toHaveCount(1);
  await expect(page.getByText('尚未记录', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Fixture Starter', { exact: true })).toHaveCount(0);
  await expect(page.getByText('本机尚未配置账户探测', { exact: true })).toBeVisible();
  await expect(page.getByText('套餐到期', { exact: true })).toHaveCount(0);
  expect(reads).toBe(2);
});

test('external catalog sends identifier URL and title searches to the server and keeps read-only detail access', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/admin/me', route => reply(route, envelope({ ...staff, permissions: ['vehicles:read'] })));
  const summary = {
    ...listing.identity, id: listing.id, version: listing.version, title: '合成挂牌车型',
    listingUrl: listing.source!.listingUrl, state: 'published', hasOverrides: true,
    fetchedAt: listing.fetchedAt, sourceUpdatedAt: null, publishedAt: null,
  };
  const unsafe = {
    ...summary, id: records[1]!.listingId!, title: '待核对的地址', listingUrl: 'javascript:alert(1)',
    state: 'hidden', hasOverrides: false,
  };
  const searches: Array<{ q: string | null; page: string | null; pageSize: string | null }> = [];
  await page.route(`**${root}/listings?*`, route => {
    const params = new URL(route.request().url()).searchParams;
    searches.push({ q: params.get('q'), page: params.get('page'), pageSize: params.get('pageSize') });
    const currentPage = Number(params.get('page'));
    return reply(route, envelope({ items: currentPage <= 2 ? [summary, unsafe] : [], page: currentPage, pageSize: 25, total: 27 }));
  });
  const manualTitle = '员工修订的标题';
  const projected = listing.vehicle!;
  await page.route(`**${root}/listings/${listing.id}?*`, route => reply(route, envelope({
    ...listing,
    overrides: { ...listing.overrides, text: [{ field: 'title', locale: 'zh', text: manualTitle, sourceHash: 'd'.repeat(64) }] },
    vehicle: { ...projected, content: { ...projected.content, title: { ...projected.content.title, text: manualTitle, kind: 'human' } } },
  })));
  await page.goto('/admin/public-catalog');
  await expect(page.getByRole('heading', { name: '三方车源管理' })).toBeVisible();
  const search = page.getByRole('searchbox', { name: '搜索三方车源' });
  for (const q of [summary.id, summary.externalId, summary.listingUrl, summary.title]) {
    await search.fill(q);
    await search.press('Enter');
    await expect.poll(() => searches.at(-1)).toEqual({ q, page: '1', pageSize: '25' });
  }
  await page.locator('.ant-pagination-next button').click();
  await expect.poll(() => searches.at(-1)).toEqual({ q: summary.title, page: '2', pageSize: '25' });
  const row = page.getByRole('row').filter({ hasText: summary.title });
  await expect(row).toContainText(summary.externalId);
  await expect(row).toContainText('已展示');
  await expect(row).toContainText('已修订');
  await expect(row.getByRole('link', { name: '访问原站' })).toHaveAttribute('href', summary.listingUrl);
  const unsafeRow = page.getByRole('row').filter({ hasText: unsafe.title });
  await expect(unsafeRow).toContainText('人工隐藏');
  await expect(unsafeRow.getByRole('link', { name: '访问原站' })).toHaveCount(0);
  await row.getByRole('link', { name: summary.title }).click();
  await expect(page.getByRole('heading', { name: '外部挂牌详情' })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: '后台导航' });
  await expect(navigation.getByRole('menuitem', { name: /三方车源管理/ })).toHaveClass(/ant-menu-item-selected/);
  const comparisonCard = page.locator('.ant-card').filter({ has: page.getByText('原文与译文', { exact: true }) });
  await expect(comparisonCard.getByText(manualTitle, { exact: true })).toBeVisible();
  const projectionCard = page.locator('.ant-card').filter({ has: page.getByText('公开展示核对', { exact: true }) });
  await expect(projectionCard).toContainText(manualTitle);
  await expect(page.getByText('原文有更新，当前仍使用人工修订，请核对', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '人工修订', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '返回三方车源管理' }).click();
  await expect(search).toHaveValue(summary.title);
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
  await page.goto(`/admin/public-catalog?${new URLSearchParams({ q: summary.title, page: '9' })}`);
  await expect(row).toBeVisible();
  expect(searches.slice(-2)).toEqual([
    { q: summary.title, page: '9', pageSize: '25' },
    { q: summary.title, page: '2', pageSize: '25' },
  ]);
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
  await search.fill('新搜索');
  await search.press('Enter');
  await expect.poll(() => searches.at(-1)).toEqual({ q: '新搜索', page: '1', pageSize: '25' });
  await page.setViewportSize({ width: 320, height: 850 });
  await expect(page.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('external overview counts all listings and composes attribute filters on the server', async ({ page }) => {
  await setup(page);
  const searches: URLSearchParams[] = [];
  await page.route(`**${root}/listings?*`, route => {
    const params = new URL(route.request().url()).searchParams;
    searches.push(params);
    return reply(route, envelope({ items: [], page: 1, pageSize: 25, total: 0 }));
  });
  await page.goto('/admin/public-catalog');
  const overview = page.getByRole('region', { name: '车源概览' });
  for (const value of ['200', '170', '20', '10', '待核验']) await expect(overview.getByText(value, { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '车型', exact: true })).toBeDisabled();
  await select(page, '品牌', '丰田');
  await select(page, '车型', '示例 R1');
  await select(page, '来源平台', '懂车帝');
  await select(page, '挂牌状态', '已展示');
  await select(page, '动力类型', '油电混动');
  await select(page, '年款', '2024 款');
  await select(page, '里程上限', '30,000 公里以内');
  const search = page.getByRole('searchbox', { name: '搜索三方车源' });
  await search.fill('R1');
  await search.press('Enter');
  await expect.poll(() => Object.fromEntries(searches.at(-1) ?? [])).toEqual({
    page: '1', pageSize: '25', q: 'R1', make: 'toyota', model: 'synthetic-r1',
    platformId: 'dongchedi', state: 'published', powertrain: 'hev', yearMin: '2024', yearMax: '2024', mileageMax: '30000',
  });
  await expect(overview.getByText('200', { exact: true })).toBeVisible();
  await search.fill('未提交文字');
  await page.getByRole('button', { name: '清空筛选' }).click();
  await expect(search).toHaveValue('');
  await select(page, '品牌', '丰田');
  await search.fill('未提交的品牌关键词');
  await page.getByRole('button', { name: '清空筛选' }).click();
  await expect(search).toHaveValue('');
  await expect.poll(() => Object.fromEntries(searches.at(-1) ?? [])).toEqual({ page: '1', pageSize: '25' });
});

test('external detail confirms a stale manual value only in the matching public language and field', async ({ page }) => {
  await setup(page);
  const sourceHash = 'd'.repeat(64);
  const title = '旧人工标题';
  const model = '人工车型名称';
  const description = '旧人工描述';
  const text = [
    { field: 'title', locale: 'zh', text: title, sourceHash },
    { field: 'title', locale: 'en', text: title, sourceHash },
    { field: 'model', locale: 'zh', text: model, sourceHash },
    { field: 'description', locale: 'zh', text: description, sourceHash },
  ];
  await page.route(`**${root}/listings/${listing.id}?*`, route => {
    const english = new URL(route.request().url()).searchParams.get('locale') === 'en';
    const projected = makeExternalAdminFixture(english ? 'en' : 'zh').listing.vehicle!;
    return reply(route, envelope({
      ...listing,
      overrides: { ...listing.overrides, text },
      vehicle: {
        ...projected,
        content: {
          title: { ...projected.content.title, text: title, kind: english ? 'human' : 'supplier' },
          description: { ...projected.content.title, text: '另一个人工描述', kind: 'human' },
        },
        display: {
          ...projected.display!,
          model: english ? projected.display!.model
            : { ...projected.display!.model, text: model, provenance: 'human' },
        },
      },
    }));
  });
  const active = '原文有更新，当前仍使用人工修订，请核对';
  const pending = '原文有更新，人工修订待核对';
  function comparison(label: string) {
    return page.locator('section').filter({ has: page.getByRole('heading', { name: label, exact: true }) })
      .filter({ hasNot: page.getByRole('heading', { name: '外部挂牌详情', exact: true }) });
  }
  await page.goto(`${ui}/listings/${listing.id}?locale=zh`);
  await expect(comparison('车型').getByText(active, { exact: true })).toBeVisible();
  await expect(comparison('标题').getByText(pending, { exact: true })).toHaveCount(2);
  await expect(comparison('描述').getByText(pending, { exact: true })).toBeVisible();
  await expect(page.getByText(active, { exact: true })).toHaveCount(1);

  await page.goto(`${ui}/listings/${listing.id}?locale=en`);
  await expect(comparison('标题').getByText(active, { exact: true })).toBeVisible();
  await expect(comparison('标题').getByText(pending, { exact: true })).toBeVisible();
  await expect(page.getByText(active, { exact: true })).toHaveCount(1);
  await expect(page.getByText(pending, { exact: true })).toHaveCount(3);
});

test('external batches expose source conflict and usage details to editors at mobile width', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/admin/vehicles');
  await page.getByRole('link', { name: '查看三方车源', exact: true }).click();
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  const navigation = page.getByRole('dialog').getByRole('navigation', { name: '后台导航' });
  await expect(navigation.getByRole('link').last()).toHaveText('三方 API 状态');
  await navigation.getByRole('link', { name: '三方 API 状态', exact: true }).click();
  await page.getByRole('link', { name: '历史导入批次', exact: true }).click();
  await expect(page.getByRole('heading', { name: '历史导入批次' })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回车辆管理', exact: true })).toHaveAttribute('href', '/admin/vehicles');
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
  await dialog.getByRole('spinbutton', { name: '年款修订值' }).fill('2025');
  await dialog.getByRole('textbox', { name: '标题 · 中文人工文案' }).fill('员工修订标题');
  await dialog.getByRole('button', { name: '保存修订' }).click();
  await expect(dialog.getByText(/记录已被其他同事更新/)).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '标题 · 中文人工文案' })).toHaveValue('员工修订标题');
  await expect(dialog.getByRole('button', { name: '保存修订' })).toBeDisabled();
  await dialog.getByRole('button', { name: '核对最新版本' }).click();
  await expect(dialog.getByText(/当前版本 4，本次编辑基于版本 3/)).toBeVisible();
  await dialog.getByRole('button', { name: '放弃输入并重新读取挂牌' }).click();
  await page.getByRole('button', { name: '确认放弃' }).click();
  await page.getByRole('button', { name: '人工修订' }).click();
  await dialog.getByRole('spinbutton', { name: '年款修订值' }).fill('2025');
  await dialog.getByRole('textbox', { name: '标题 · 中文人工文案' }).fill('员工修订标题');
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
  await page.setViewportSize({ width: 320, height: 850 });
  await page.route(`**${root}/listings/${listing.id}/overrides`, route => {
    const payload = SaveExternalOverridesSchema.parse(route.request().postDataJSON());
    expect(payload.overrides.facts.model?.name).toBe('另一个车型名称');
    expect(payload.overrides.text).toEqual(listing.overrides.text);
    return reply(route, envelope({ id: listing.id, version: listing.version + 1, state: 'published' }));
  });
  await page.goto(`${ui}/listings/${listing.id}`);
  await page.getByRole('button', { name: '人工修订' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '车型 · 中文人工文案' }).fill('待保存车型译文');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await dialog.getByRole('textbox', { name: '车型名称', exact: true }).fill('另一个车型名称');
  await expect(dialog.getByRole('button', { name: '保存修订' })).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: '车型 · 中文人工文案' })).toHaveValue('待保存车型译文');
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
  await page.goto(`${ui}/batches`);
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
  await page.goto(`${ui}/batches`);
  await page.getByRole('button', { name: '导入批次' }).click();
  await page.getByLabel('规范化批次 JSON').setInputFiles({
    name: 'synthetic-deep-row.json', mimeType: 'application/json', buffer: Buffer.from(body),
  });
  await page.getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByText('导入完成，请查看批次结果。')).toBeVisible();
});
