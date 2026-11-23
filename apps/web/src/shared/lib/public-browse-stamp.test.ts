import { expect, it } from 'vitest';
import { parsePublicBrowseStamp } from './public-browse-stamp';
import { capturePublicBrowseRender, markPublicHtmlRenderComplete, recordPublicBrowseStamp } from './public-html-render-proof';

const now = Date.parse('2026-11-23T11:00:00Z');
const generation = 'a'.repeat(64);
const header = (observedAt: number, expiresAt: number) => new Headers({
  'X-HD-Browse-Policy': 'browse-600-v1',
  'X-HD-Browse-Generation': generation,
  'X-HD-Browse-Generated-At': new Date(observedAt).toISOString(),
  'X-HD-Browse-Expires-At': new Date(expiresAt).toISOString(),
});
const document = () => new Response('<main>public browse</main>', { headers: { 'Content-Type': 'text/html' } });

it('retains the origin clock on a hit and rejects expiry extension, future generation and missing authority', () => {
  const observedAt = now - 599_000;
  const expiresAt = now + 1_000;
  const headers = header(observedAt, expiresAt);
  expect(parsePublicBrowseStamp(headers, now)).toEqual({ generation, observedAt, expiresAt });
  expect(parsePublicBrowseStamp(headers, expiresAt)).toBeNull();
  expect(parsePublicBrowseStamp(header(observedAt, expiresAt + 1), now)).toBeNull();
  expect(parsePublicBrowseStamp(header(now + 1, now + 3000), now)).toBeNull();
  headers.delete('X-HD-Browse-Policy');
  expect(parsePublicBrowseStamp(headers, now)).toBeNull();
});

it('publishes the oldest observation and earliest actual media/FX bound for a document', async () => {
  const { response, proof } = await capturePublicBrowseRender(async ticket => {
    recordPublicBrowseStamp(ticket, { generation, observedAt: now - 550_000, expiresAt: now + 45_000 });
    recordPublicBrowseStamp(ticket, { generation, observedAt: now - 30_000, expiresAt: now + 500 });
    markPublicHtmlRenderComplete(ticket);
    return document();
  }, () => now);
  expect(await response.text()).toContain('public browse');
  expect(proof).toEqual({ generation, observedAt: now - 550_000, expiresAt: now + 500 });
});

it('refuses mixed purge generations and incomplete documents', async () => {
  for (const complete of [false, true]) {
    const { proof } = await capturePublicBrowseRender(async ticket => {
      const stamp = { generation, observedAt: now, expiresAt: now + 30_000 };
      recordPublicBrowseStamp(ticket, stamp);
      if (complete) {
        recordPublicBrowseStamp(ticket, { ...stamp, generation: 'b'.repeat(64) });
        markPublicHtmlRenderComplete(ticket);
      }
      return document();
    }, () => now);
    expect(proof).toBeNull();
  }
});
