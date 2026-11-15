/** Private report links: browser contract simulations only, without opening any report or external service. */
import { expect, test, type Page } from '@playwright/test';
import { AdminVehicleSchema, ExternalListingSchema, PublicationPreviewSchema, SaveVehicleRequestSchema, parseVehicleDraftWrite, type AdminVehicle, type AdminReport, type ExternalListing } from '@hd/contracts/admin';
import { PublicVehicleSchema } from '@hd/contracts/public';
import { makeExternalAdminFixture, makeExternalStructuredPublicVehicleFixture, makeExternalVehicleDraftFixture, makePublicationPreviewFixture } from '@hd/contracts/fixtures';
import { envelope, error, installApi, reply, vehicle } from './api-fixture';
import { notes, tab } from './ui-helpers';

const reportUrl = 'https://reports.example.invalid/only-for-contract/synthetic-0001?language=zh&ref=fixture';
const employeeId = '62000000-0000-4000-8000-000000000011';
const reportLink = (page: Page) => page.getByRole('link', { name: '打开来源报告', exact: true });
function employee() { return AdminVehicleSchema.parse({ ...vehicle(), id: employeeId, draft: makeExternalVehicleDraftFixture(), report: { hasReport: true, url: reportUrl } }); }
function external() { const listing = makeExternalAdminFixture().listing; listing.report = { hasReport: true, url: reportUrl }; return ExternalListingSchema.parse(listing); }
const listingApi = (item: ExternalListing) => `**/api/v1/admin/external/listings/${item.id}?*`;
async function preventExternalRequests(page: Page) {
  const attempted: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3319') return route.fallback();
    attempted.push(url.origin); return route.abort('blockedbyclient');
  });
  return attempted;
}
async function expectPrivateLink(page: Page) {
  await expect(reportLink(page)).toHaveCount(1); await expect(reportLink(page)).toHaveAttribute('href', reportUrl);
  await expect(reportLink(page)).toHaveAttribute('target', '_blank'); await expect(reportLink(page)).toHaveAttribute('rel', 'noopener noreferrer');
}

for (const surface of ['employee', 'external'] as const) {
  test(`report ${surface} detail uses the exact private HTTPS metadata without automatically fetching it`, async ({ page }) => {
    const item = employee(), listing = external();
    const api = await installApi(page, { items: [item], permissions: surface === 'external' ? ['vehicles:read'] : ['vehicles:read', 'vehicles:write'] });
    await page.route(listingApi(listing), route => reply(route, envelope(listing)));
    const externalRequests = await preventExternalRequests(page);
    await page.goto(surface === 'employee' ? `/admin/vehicles/${item.id}` : `/admin/external-sources/listings/${listing.id}`);
    await expectPrivateLink(page);
    if (surface === 'external') await expect(page.getByRole('button', { name: '人工修订', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 844 }); await expect(reportLink(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(externalRequests).toEqual([]); expect(api.saves).toEqual([]); expect(api.translationGenerations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`report-${surface}-private-link-320.png`), fullPage: true, animations: 'disabled' });
  });

  test(`report ${surface} detail has no link without a private URL even if source candidate or public status suggests a report`, async ({ page }) => {
    const item = employee(), listing = external(); const api = await installApi(page, { items: [item] });
    await page.route(listingApi(listing), route => reply(route, envelope(listing))); const externalRequests = await preventExternalRequests(page);
    for (const metadata of [undefined, { hasReport: true, url: null }, { hasReport: false, url: null }] satisfies Array<AdminReport | undefined>) {
      if (metadata) { item.report = metadata; listing.report = metadata; } else { delete item.report; delete listing.report; }
      // The old raw candidate URL must never supply a fallback for the new private report metadata.
      expect(listing.source?.inspection?.reportUrl).toBeTruthy();
      await page.goto(surface === 'employee' ? `/admin/vehicles/${item.id}` : `/admin/external-sources/listings/${listing.id}`);
      await expect(page.getByRole('heading', { name: surface === 'employee' ? '编辑车辆草稿' : '外部挂牌详情', exact: true })).toBeVisible();
      if (surface === 'external') await expect(page.getByText(`管理版本 ${listing.version}`, { exact: true })).toBeVisible();
      await expect(reportLink(page)).toHaveCount(0); await expect(page.locator(`a[href="${reportUrl}"]`)).toHaveCount(0);
      if (surface === 'employee') await expect(page.getByText('来源报告', { exact: true })).toHaveCount(0);
    }
    expect(externalRequests).toEqual([]); expect(api.saves).toEqual([]);
  });

  test(`report ${surface} detail rejects unsafe private URL responses without rendering or requesting them`, async ({ page }) => {
    const item = employee(), listing = external(); await installApi(page, { items: [item] });
    let unsafeUrl = '';
    const routePath = surface === 'employee' ? `**/api/v1/admin/vehicles/${item.id}?includeDeleted=true` : listingApi(listing);
    await page.route(routePath, route => reply(route, envelope({ ...(surface === 'employee' ? item : listing), report: { hasReport: true, url: unsafeUrl } })));
    const externalRequests = await preventExternalRequests(page);
    for (const unsafe of ['http://reports.example.invalid/synthetic', 'javascript:alert(1)', 'https://synthetic-user:synthetic-pass@reports.example.invalid/synthetic']) {
      unsafeUrl = unsafe;
      const candidate = { ...(surface === 'employee' ? item : listing), report: { hasReport: true, url: unsafeUrl } };
      expect((surface === 'employee' ? AdminVehicleSchema : ExternalListingSchema).safeParse(candidate).success).toBe(false);
      await page.goto(surface === 'employee' ? `/admin/vehicles/${item.id}` : `/admin/external-sources/listings/${listing.id}`);
      await expect(page.getByText('服务返回的数据无法识别，请联系维护人员。', { exact: true })).toBeVisible();
      await expect(reportLink(page)).toHaveCount(0); expect(await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))).not.toContain(unsafe);
    }
    expect(externalRequests).toEqual([]);
  });

  test(`report ${surface} route permissions prevent detail reads and private URL disclosure`, async ({ page }) => {
    const item = employee(), listing = external(); await installApi(page, { items: [item], permissions: [] }); let detailReads = 0;
    const routePath = surface === 'employee' ? `**/api/v1/admin/vehicles/${item.id}?includeDeleted=true` : listingApi(listing);
    await page.route(routePath, route => { detailReads++; return reply(route, envelope(surface === 'employee' ? item : listing)); });
    const externalRequests = await preventExternalRequests(page);
    await page.goto(surface === 'employee' ? `/admin/vehicles/${item.id}` : `/admin/external-sources/listings/${listing.id}`);
    await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible(); await expect(reportLink(page)).toHaveCount(0);
    expect(detailReads).toBe(0); expect(await page.locator('body').innerText()).not.toContain(reportUrl); expect(externalRequests).toEqual([]);
  });

  test(`report ${surface} API permission refusal exposes no report link or private data`, async ({ page }) => {
    const item = employee(), listing = external(); await installApi(page, { items: [item] }); let detailReads = 0;
    const routePath = surface === 'employee' ? `**/api/v1/admin/vehicles/${item.id}?includeDeleted=true` : listingApi(listing);
    await page.route(routePath, route => { detailReads++; return reply(route, error('FORBIDDEN'), 403); }); const externalRequests = await preventExternalRequests(page);
    await page.goto(surface === 'employee' ? `/admin/vehicles/${item.id}` : `/admin/external-sources/listings/${listing.id}`);
    await expect(page.getByText('当前账号没有此操作权限。（参考编号：browser-contract-test）', { exact: true })).toBeVisible();
    await expect(reportLink(page)).toHaveCount(0); expect(detailReads).toBe(1); expect(await page.locator('body').innerText()).not.toContain(reportUrl); expect(externalRequests).toEqual([]);
  });
}

test('report unsaved employee source changes hide the old private link until its original binding is restored', async ({ page }) => {
  const item = employee(); const api = await installApi(page, { items: [item] }); const externalRequests = await preventExternalRequests(page);
  await page.goto(`/admin/vehicles/${item.id}`); await expectPrivateLink(page); const originalSource = item.draft.source.kind === 'external' ? item.draft.source.listingUrl : '';
  const input = page.getByLabel('原始挂牌链接', { exact: true }); await input.fill('https://example.invalid/listings/another-synthetic-identity');
  await expect(reportLink(page)).toHaveCount(0); await expect(page.getByText('来源报告', { exact: true })).toHaveCount(0); expect(api.saves).toEqual([]);
  await tab(page, '发布预览'); await expect(reportLink(page)).toHaveCount(0); expect(api.previewConfirmations).toEqual([]);
  await tab(page, '基础资料'); await input.fill(originalSource); await expectPrivateLink(page);
  expect(api.saves).toEqual([]); expect(externalRequests).toEqual([]);
});

test('report public and preview projections accept presence only and strictly reject private or legacy report addresses', async ({ page }) => {
  const item = employee(); const preview = makePublicationPreviewFixture(); preview.vehicle.id = item.id; preview.vehicle.report = { hasReport: true };
  const publicVehicle = makeExternalStructuredPublicVehicleFixture(); publicVehicle.report = { hasReport: true };
  expect(PublicVehicleSchema.safeParse(publicVehicle).success).toBe(true); expect(PublicationPreviewSchema.safeParse(preview).success).toBe(true);
  expect(PublicVehicleSchema.safeParse({ ...publicVehicle, report: { hasReport: true, url: reportUrl } }).success).toBe(false);
  expect(PublicationPreviewSchema.safeParse({ ...preview, vehicle: { ...preview.vehicle, report: { hasReport: true, url: reportUrl } } }).success).toBe(false);
  const inspection = publicVehicle.external!.detail!.inspection!;
  expect(inspection.reportUrl).toBeNull(); expect(inspection.reportAccess).toEqual({ status: 'unknown', url: null, checkedAt: null, expiresAt: null });
  for (const privateData of [{ reportUrl }, { reportAccess: { status: 'available', url: reportUrl, checkedAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-12T00:10:00Z' } }]) {
    const leaked = structuredClone(publicVehicle); Object.assign(leaked.external!.detail!.inspection!, privateData); expect(PublicVehicleSchema.safeParse(leaked).success).toBe(false);
  }
  await installApi(page, { items: [item], publicationPreviews: [preview] }); const externalRequests = await preventExternalRequests(page);
  await page.goto(`/admin/vehicles/${item.id}`); await expectPrivateLink(page);
  const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/publication-preview'));
  await tab(page, '发布预览'); const projection = PublicationPreviewSchema.parse((await (await response).json()).data);
  expect(projection.vehicle.report).toEqual({ hasReport: true }); expect(JSON.stringify(projection)).not.toContain(reportUrl);
  expect(externalRequests).toEqual([]);
});

/** Older mutation receipts omit private report metadata; only the following detail read supplies it. */
async function reportlessSaves(page: Page, item: AdminVehicle) {
  const writes: Array<{ version: number; notes: string | null }> = [];
  await page.route(`**/api/v1/admin/vehicles/${item.id}`, route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const input = SaveVehicleRequestSchema.parse(route.request().postDataJSON());
    writes.push({ version: input.version, notes: input.draft.internal.notes });
    if (input.version !== item.version) return reply(route, error('VERSION_CONFLICT'), 409);
    item.draft = parseVehicleDraftWrite(input.draft); item.version++;
    const receipt = structuredClone(item); delete receipt.report;
    return reply(route, envelope(AdminVehicleSchema.parse(receipt)));
  });
  return writes;
}
async function delayReportRefresh(page: Page, item: AdminVehicle, response: () => AdminVehicle, initialReadsToSkip = 1) {
  let reads = 0, started = false, release!: () => void, finish!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; }); const finished = new Promise<void>(resolve => { finish = resolve; });
  await page.route(`**/api/v1/admin/vehicles/${item.id}?includeDeleted=true`, async route => {
    reads++;
    if (reads !== initialReadsToSkip + 1) return route.fallback();
    const snapshot = AdminVehicleSchema.parse(structuredClone(response())); started = true;
    await pause;
    try { await reply(route, envelope(snapshot)); } catch { /* A later version or route may have deliberately aborted this read. */ }
    finally { finish(); }
  });
  return { get started() { return started; }, get reads() { return reads; }, release, finished };
}
async function flushRenderedResponse(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('report refresh after a reportless save merges metadata without losing newer local input or its leave guard', async ({ page }) => {
  const item = employee(); await installApi(page, { items: [item] }); const writes = await reportlessSaves(page, item);
  const held = await delayReportRefresh(page, item, () => item); const externalRequests = await preventExternalRequests(page);
  await page.goto(`/admin/vehicles/${item.id}`); await expectPrivateLink(page);
  await (await notes(page)).fill('第一次已保存的备注'); await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => held.started).toBe(true); await expect(reportLink(page)).toHaveCount(0);
  await page.getByLabel('内部备注', { exact: true }).fill('GET等待期间新增、尚未保存的备注');
  await expect(page.getByRole('button', { name: /保存草稿$/ })).toBeEnabled(); held.release(); await held.finished;
  await expectPrivateLink(page); await expect(page.getByLabel('内部备注', { exact: true })).toHaveValue('GET等待期间新增、尚未保存的备注');
  await expect(page.getByRole('button', { name: /保存草稿$/ })).toBeEnabled();
  await page.getByRole('button', { name: /返回车辆列表$/ }).click(); await expect(page.getByRole('dialog', { name: '离开当前草稿？', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click(); await expect(page.getByLabel('内部备注', { exact: true })).toHaveValue('GET等待期间新增、尚未保存的备注');
  expect(writes).toEqual([{ version: 1, notes: '第一次已保存的备注' }]); expect(item.version).toBe(2); expect(held.reads).toBe(2); expect(externalRequests).toEqual([]);
});

for (const mismatch of ['source binding', 'vehicle version'] as const) {
  test(`report refresh refuses a delayed ${mismatch} mismatch after an external source save`, async ({ page }) => {
    const item = employee(); const old = structuredClone(item); await installApi(page, { items: [item] }); const writes = await reportlessSaves(page, item);
    const held = await delayReportRefresh(page, item, () => {
      const response = structuredClone(item);
      if (mismatch === 'source binding') response.draft.source = structuredClone(old.draft.source);
      else response.version = old.version;
      return response;
    });
    const externalRequests = await preventExternalRequests(page); await page.goto(`/admin/vehicles/${item.id}`); await expectPrivateLink(page);
    const nextSource = 'https://example.invalid/listings/new-synthetic-source-binding'; await page.getByLabel('原始挂牌链接', { exact: true }).fill(nextSource);
    await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => held.started).toBe(true); await expect(reportLink(page)).toHaveCount(0);
    await (await notes(page)).fill('晚到报告不能覆盖本地备注');
    const received = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/admin/vehicles/${item.id}` && response.request().method() === 'GET');
    held.release(); await held.finished; await (await received).finished(); await flushRenderedResponse(page);
    await expect(reportLink(page)).toHaveCount(0); await expect(page.getByLabel('内部备注', { exact: true })).toHaveValue('晚到报告不能覆盖本地备注');
    await tab(page, '基础资料'); await expect(page.getByLabel('原始挂牌链接', { exact: true })).toHaveValue(nextSource);
    expect(writes).toHaveLength(1); expect(writes[0]!.version).toBe(1); expect(item.version).toBe(2); expect(externalRequests).toEqual([]);
  });
}

test('report refresh from an older save cannot replace a newer version report or draft', async ({ page }) => {
  const item = employee(); await installApi(page, { items: [item] }); const writes = await reportlessSaves(page, item);
  const held = await delayReportRefresh(page, item, () => item); const externalRequests = await preventExternalRequests(page);
  await page.goto(`/admin/vehicles/${item.id}`); await (await notes(page)).fill('版本二备注'); await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => held.started).toBe(true); await page.getByLabel('内部备注', { exact: true }).fill('版本三备注');
  const newerUrl = 'https://reports.example.invalid/only-for-contract/version-three'; item.report = { hasReport: true, url: newerUrl };
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect(reportLink(page)).toHaveAttribute('href', newerUrl);
  held.release(); await held.finished; await flushRenderedResponse(page);
  await expect(reportLink(page)).toHaveAttribute('href', newerUrl); await expect(page.getByLabel('内部备注', { exact: true })).toHaveValue('版本三备注');
  await expect(page.getByRole('button', { name: /保存草稿$/ })).toBeDisabled(); expect(item.version).toBe(3);
  expect(writes).toEqual([{ version: 1, notes: '版本二备注' }, { version: 2, notes: '版本三备注' }]); expect(externalRequests).toEqual([]);
});

test('report refresh from a departed vehicle cannot attach its private URL to the next vehicle', async ({ page }) => {
  const item = employee(), next = employee(); next.id = '62000000-0000-4000-8000-000000000012'; next.stockCode = 'NEXT-REPORT-FIXTURE'; next.version = 11;
  next.draft.internal.notes = '第二辆车的已保存备注'; next.report = { hasReport: true, url: 'https://reports.example.invalid/only-for-contract/second-vehicle' };
  await installApi(page, { items: [item, next] }); const writes = await reportlessSaves(page, item);
  const held = await delayReportRefresh(page, item, () => item); const externalRequests = await preventExternalRequests(page);
  await page.goto(`/admin/vehicles/${item.id}`); await (await notes(page)).fill('离开前保存第一辆车'); await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => held.started).toBe(true);
  await page.getByRole('button', { name: /返回车辆列表$/ }).click(); await expect(page).toHaveURL(/\/admin\/vehicles$/);
  await page.getByRole('row').filter({ has: page.getByText(next.stockCode, { exact: true }) }).getByRole('link', { name: '编辑', exact: true }).click();
  await expect(reportLink(page)).toHaveAttribute('href', next.report.url!); await expect(await notes(page)).toHaveValue('第二辆车的已保存备注');
  held.release(); await held.finished; await flushRenderedResponse(page);
  await expect(reportLink(page)).toHaveAttribute('href', next.report.url!); await expect(page).toHaveURL(new RegExp(`${next.id}$`));
  await expect(page.getByLabel('内部备注', { exact: true })).toHaveValue('第二辆车的已保存备注'); expect(writes).toHaveLength(1); expect(next.version).toBe(11); expect(externalRequests).toEqual([]);
});

test('report refresh cannot revive a private link after session expiry or logout while same-account input remains recoverable', async ({ page }) => {
  const item = employee(); const api = await installApi(page, { items: [item] }); const writes = await reportlessSaves(page, item);
  const expiredRead = await delayReportRefresh(page, item, () => item); let rejectNextSave = false, rejected = 0;
  await page.route(`**/api/v1/admin/vehicles/${item.id}`, route => {
    if (route.request().method() !== 'PATCH' || !rejectNextSave) return route.fallback();
    rejectNextSave = false; rejected++; api.authenticated = false; return reply(route, error('UNAUTHENTICATED'), 401);
  });
  const externalRequests = await preventExternalRequests(page); await page.goto(`/admin/vehicles/${item.id}`); await expectPrivateLink(page);
  await (await notes(page)).fill('失效前已保存'); await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => expiredRead.started).toBe(true);
  await page.getByLabel('内部备注', { exact: true }).fill('同账号重新登录必须保留的新输入'); rejectNextSave = true;
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect(page.getByLabel('账号或工作邮箱')).toBeVisible();
  await expect(page.locator(`a[href="${reportUrl}"]`)).toHaveCount(0);
  expiredRead.release(); await expiredRead.finished; await flushRenderedResponse(page); await expect(page.locator(`a[href="${reportUrl}"]`)).toHaveCount(0);
  await page.getByLabel('账号或工作邮箱').fill('editor@example.invalid'); await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/email');
  const staff = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/me');
  await page.getByRole('button', { name: /登录工作台$/ }).click(); expect((await login).status()).toBe(200); expect((await staff).status()).toBe(200);
  await expect(page.getByLabel('账号或工作邮箱')).toBeHidden(); await expect(page.locator('.workspace')).not.toHaveAttribute('inert');
  await expect(page.getByLabel('内部备注', { exact: true })).toHaveValue('同账号重新登录必须保留的新输入'); await expect(reportLink(page)).toHaveCount(0);
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => writes.length).toBe(2);
  await expect(reportLink(page)).toHaveCount(0); await expect(page.getByRole('button', { name: /保存草稿$/ })).toBeDisabled();
  await page.reload(); await expectPrivateLink(page); await expect(await notes(page)).toHaveValue('同账号重新登录必须保留的新输入');
  expect(writes).toEqual([{ version: 1, notes: '失效前已保存' }, { version: 2, notes: '同账号重新登录必须保留的新输入' }]); expect(rejected).toBe(1);
  const logoutRead = await delayReportRefresh(page, item, () => item, 0);
  await page.getByLabel('内部备注', { exact: true }).fill('退出前已保存'); await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => logoutRead.started).toBe(true);
  await page.getByRole('button', { name: /退出登录$/ }).click(); await expect(page.getByRole('heading', { name: '登录员工工作台', exact: true })).toBeVisible();
  logoutRead.release(); await logoutRead.finished; await flushRenderedResponse(page);
  await expect(reportLink(page)).toHaveCount(0); await expect(page.locator(`a[href="${reportUrl}"]`)).toHaveCount(0); await expect(page.locator('.workspace')).toHaveCount(0);
  expect(api.authenticated).toBe(false); expect(writes).toHaveLength(3); expect(externalRequests).toEqual([]);
});
