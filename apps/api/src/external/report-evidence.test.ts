import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { makeExternalStructuredCandidateFixture } from '@hd/contracts/fixtures';
import { jsonHash } from './normalize.js';
import { PublicCatalogCache } from './public-cache.js';
import type { PublicCacheStore } from './redis-cache.js';
import { projectReportAccess, reportBinding, type ReportEvidenceRow, type ReportSourceRow } from './report-evidence.js';

const now = Date.parse('2026-11-12T00:00:00Z');
function fixture() {
  const candidate = makeExternalStructuredCandidateFixture(), { fetchedAt: _time, ...stable } = candidate;
  const source: ReportSourceRow = { id: randomUUID(), provider: 'synthetic-feed', platform_id: candidate.platformId,
    external_id: candidate.externalId, source_revision: String(candidate.revision), source_hash: jsonHash(stable), source_data: candidate, upstream_state: 'active' };
  const binding = reportBinding(source)!;
  const observation = { listingId: source.id, outcome: 'available' as const, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1000).toISOString(),
    httpStatus: 200, finalUrl: binding.reportUrl, verifiedReportContent: true, matchedVehicle: true, evidenceHash: 'a'.repeat(64) };
  const evidence: ReportEvidenceRow = { binding, observation, observation_hash: jsonHash(observation), checked_at: new Date(now), expires_at: new Date(now + 1000) };
  return { source, evidence, observation };
}

test('available requires exact current source identity, version, URL and verified report content', () => {
  const { source, evidence } = fixture();
  assert.equal(projectReportAccess(source, evidence, now).status, 'available');
  for (const change of [
    { id: randomUUID() }, { provider: 'unregistered' }, { platform_id: 'synthetic-market-alt' }, { external_id: 'another-car' },
    { source_revision: '999' }, { source_hash: 'b'.repeat(64) }, { upstream_state: 'withdrawn' },
    { source_data: { ...source.source_data!, inspection: { ...source.source_data!.inspection!, reportUrl: 'https://reports.example.invalid/another' } } },
    { source_data: { ...source.source_data!, disputes: ['modelYear' as const] } },
  ]) assert.equal(projectReportAccess({ ...source, ...change }, evidence, now).status, 'unknown');
  assert.equal(projectReportAccess(source, null, now).status, 'unknown');
  for (const change of [{ httpStatus: 404 }, { verifiedReportContent: false }, { matchedVehicle: false }, { finalUrl: null },
    { finalUrl: 'https://reports.example.invalid/redirect' }]) {
    const observation = { ...(evidence.observation as object), ...change };
    assert.equal(projectReportAccess(source, { ...evidence, observation, observation_hash: jsonHash(observation) }, now).status, 'unknown');
  }
});

test('evidence timestamps, hashes and expiry never publish an old or future available URL', () => {
  const { source, evidence, observation } = fixture();
  assert.equal(projectReportAccess(source, evidence, now - 1).status, 'unknown');
  assert.equal(projectReportAccess(source, evidence, now + 999).status, 'available');
  assert.deepEqual(projectReportAccess(source, evidence, now + 1000), { status: 'expired', url: null,
    checkedAt: observation.checkedAt, expiresAt: observation.expiresAt });
  assert.equal(projectReportAccess(source, { ...evidence, observation_hash: 'b'.repeat(64) }, now).status, 'unknown');
  assert.equal(projectReportAccess(source, { ...evidence, checked_at: new Date(now - 1) }, now).status, 'unknown');
  const unavailable = { ...observation, outcome: 'unavailable', httpStatus: 403, finalUrl: null, matchedVehicle: false, verifiedReportContent: false };
  assert.equal(projectReportAccess(source, { ...evidence, observation: unavailable, observation_hash: jsonHash(unavailable) }, now).status, 'unavailable');
});

test('report evidence expiry cuts both memory and Redis TTL without making expired detail unreadable', async () => {
  for (const outcome of ['available', 'unavailable'] as const) {
    let clock = now, loads = 0;
    const { source, evidence, observation } = fixture();
    if (outcome === 'unavailable') { evidence.observation = { ...observation, outcome, httpStatus: 403 }; evidence.observation_hash = jsonHash(evidence.observation); }
    const values = new Map<string, string>(), ttls: number[] = [];
    const store: PublicCacheStore = { async get(key) { return values.get(key) ?? null; }, async set(key, value, ttl) { values.set(key, value); ttls.push(ttl); }, async close() {} };
    const options = { namespace: `hd:report-${outcome}`, ttlMs: 5000 };
    const dependencies = { readRevision: async () => ({ epoch: '00000000-0000-4000-8000-000000000001', revision: '1' }), now: () => clock, store };
    const first = new PublicCatalogCache(options, dependencies), second = new PublicCatalogCache(options, dependencies);
    const load = async () => { loads++; const reportAccess = projectReportAccess(source, evidence, clock);
      return { inspection: { reportAccess, reportUrl: reportAccess.status === 'available' ? reportAccess.url : null } }; };
    assert.equal((await first.get('detail', {}, load)).inspection.reportAccess.status, outcome);
    assert.equal((await first.get('detail', {}, load)).inspection.reportAccess.status, outcome);
    assert.equal((await second.get('detail', {}, load)).inspection.reportAccess.status, outcome);
    assert.equal(loads, 1); assert.deepEqual(ttls, [1000]);
    clock += 1000;
    assert.equal((await first.get('detail', {}, load)).inspection.reportAccess.status, 'expired');
    assert.equal((await second.get('detail', {}, load)).inspection.reportUrl, null);
    assert.equal(loads, 2); assert.deepEqual(ttls, [1000, 5000]);
    await first.close(); await second.close();
  }
});

test('a load crossing report expiry fails closed instead of returning an expired clickable URL', async () => {
  let clock = now;
  const { source, evidence } = fixture();
  const cache = new PublicCatalogCache({ namespace: 'hd:report-crossing' }, {
    readRevision: async () => ({ epoch: '00000000-0000-4000-8000-000000000001', revision: '1' }), now: () => clock,
  });
  await assert.rejects(cache.get('detail', {}, async () => {
    const reportAccess = projectReportAccess(source, evidence, clock); clock += 1000;
    return { inspection: { reportAccess } };
  }), { status: 503 });
  await cache.close();
});
