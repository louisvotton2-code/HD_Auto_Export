import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import { makeExternalStructuredCandidateFixture } from '@hd/contracts/fixtures';
import { canonicalJson } from './normalize.js';
import type { ReportSourceRow } from './report-evidence.js';
import { projectSourceReport } from './reports.js';
import { PublicCatalogCache } from './public-cache.js';

function fixture(): ReportSourceRow {
  const candidate = makeExternalStructuredCandidateFixture();
  return { id: randomUUID(), provider: 'synthetic-feed', platform_id: candidate.platformId, external_id: candidate.externalId,
    source_revision: '1', source_hash: 'a'.repeat(64), source_data: candidate, upstream_state: 'active' };
}
test('report presence survives missing and unsafe links and never depends on verification', () => {
  const source = fixture();
  assert.deepEqual(projectSourceReport(source), { hasReport: true, url: source.source_data!.inspection!.reportUrl });
  for (const reportUrl of [null, 'http://unsafe.invalid/report', 'https://reports.example.invalid/report?private=1', 'javascript:alert(1)']) {
    source.source_data!.inspection!.reportUrl = reportUrl;
    assert.deepEqual(projectSourceReport(source), { hasReport: true, url: null });
  }
  source.source_data!.inspection!.hasReport = false;
  assert.deepEqual(projectSourceReport(source), { hasReport: true, url: null });
  source.source_data!.inspection!.reportUrl = null;
  assert.deepEqual(projectSourceReport(source), { hasReport: false, url: null });
  source.source_data!.inspection!.hasReport = true;
  assert.deepEqual(projectSourceReport({ ...source, provider: 'unknown' }), { hasReport: false, url: null });
  assert.deepEqual(projectSourceReport({ ...source, external_id: 'different' }), { hasReport: false, url: null });
});

test('formal provider reports keep their presence without exposing an untrusted link',()=>{
  const source=fixture();source.provider='chinacarapi';source.platform_id='che168';source.source_data!.platformId='che168';
  assert.deepEqual(projectSourceReport(source),{hasReport:true,url:null});
  assert.deepEqual(projectSourceReport({...source,external_id:'mismatched'}),{hasReport:false,url:null});
});

test('offline presence enrichment is bound to every exact current source identifier and revision', () => {
  const source = fixture(); source.source_data!.inspection = null;
  const binding = { listingId: source.id, provider: source.provider, platformId: source.platform_id, externalId: source.external_id,
    sourceRevision: source.source_revision, sourceHash: source.source_hash };
  const enrichment = { binding, content: { report: { hasReport: true } } };
  assert.deepEqual(projectSourceReport(source, enrichment), { hasReport: true, url: null });
  for (const field of Object.keys(binding)) assert.deepEqual(projectSourceReport(source,
    { ...enrichment, binding: { ...binding, [field]: 'changed' } }), { hasReport: false, url: null });
  assert.deepEqual(projectSourceReport(source, { binding, content: { report: { status: 'available', url: 'https://reports.example.invalid/report' } } }),
    { hasReport: false, url: null });
});

test('cache format change rejects formerly valid report-link entries from shared storage', async () => {
  const now = Date.parse('2026-11-12T00:00:00Z'), epoch = '00000000-0000-4000-8000-000000000001';
  const oldKey = createHash('sha256').update(canonicalJson([2, epoch, '1', 'detail', canonicalJson({})])).digest('hex');
  const old = JSON.stringify({ format: 1, key: oldKey, expiresAt: now + 20_000,
    value: { reportUrl: 'https://reports.example.invalid/private-old-link' } });
  let loads = 0;
  const cache = new PublicCatalogCache({ namespace: 'hd:report-contact' }, {
    readRevision: async () => ({ epoch, revision: '1' }), now: () => now,
    store: { async get() { return old; }, async set() {}, async close() {} },
  });
  assert.deepEqual(await cache.get('detail', {}, async () => { loads++; return { report: { hasReport: true } }; }), { report: { hasReport: true } });
  assert.equal(loads, 1); assert.equal(cache.metrics().invalidEntries, 1); await cache.close();
});
