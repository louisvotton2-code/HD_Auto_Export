import { describe, expect, it } from 'vitest';
import {
  capturePublicHtmlRender,
  invalidatePublicHtmlRender,
  markPublicHtmlRenderComplete,
  parsePublicHtmlCacheStamp,
  publicHtmlRenderProtocol,
  recordPublicHtmlRenderStamp,
} from './public-html-render-proof';

const start = Date.parse('2026-11-18T02:00:00Z');
const expiresIn = (milliseconds: number) => new Date(start + milliseconds).toISOString();
const catalog = {
  version: 'a'.repeat(64),
  priceView: 'usd',
  fx: { version: 'b0000000-0000-4000-8000-000000000001', expiresAt: expiresIn(60_000) },
  checkedAt: expiresIn(0),
  validUntil: expiresIn(15_000),
};
const filters = { ...catalog, version: 'c'.repeat(64) };
const observations = [['catalog', catalog], ['filters', filters]] as const;
const maxHtmlBytes = 512 * 1024;
const encoder = new TextEncoder();

function html(body: BodyInit | null, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { ...init, headers });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function streamingHtml() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = html(new ReadableStream<Uint8Array>({
    start(streamController) { controller = streamController; },
  }));
  return {
    response,
    send: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
    fail: (error: Error) => controller.error(error),
  };
}

function capture(
  render: (ticket: string | null) => Promise<Response>,
  now = () => start,
) {
  return capturePublicHtmlRender(render, { now });
}

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

function attest(ticket: string | null, validUntil = catalog.validUntil) {
  for (const [scope, stamp] of observations)
    recordPublicHtmlRenderStamp(ticket, scope, { ...stamp, validUntil });
  markPublicHtmlRenderComplete(ticket);
}

describe('public HTML render proof', () => {
  it('waits for EOF before returning proof and replays all HTML bytes', async () => {
    const stream = streamingHtml();
    let settled = false;
    const pending = capture(async ticket => {
      attest(ticket);
      return stream.response;
    }).finally(() => { settled = true; });

    stream.send('<!doctype html><html><p>First chunk</p>');
    await nextTurn();
    const settledBeforeEof = settled;
    stream.send('<p>最后一段</p></html>');
    stream.close();
    const { proof, response } = await pending;

    expect(settledBeforeEof).toBe(false);
    expect(proof).toMatchObject({ healthy: true, data: { catalog, filters } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('<!doctype html><html><p>First chunk</p><p>最后一段</p></html>');
  });

  it('uses the earliest deadline across both dependencies and repeated reads', async () => {
    const earlierDeadline = expiresIn(13_000);
    const { proof } = await capture(async ticket => {
      recordPublicHtmlRenderStamp(ticket, 'filters', { ...filters, validUntil: earlierDeadline });
      attest(ticket);
      return html('<html>Valid</html>', { headers: { 'Content-Encoding': 'identity' } });
    });
    expect(proof).toMatchObject({
      healthy: true,
      data: {
        catalog: { version: catalog.version, validUntil: earlierDeadline },
        filters: { version: filters.version, validUntil: earlierDeadline },
      },
    });
  });

  it('uses a shorter accepted SSR deadline without extending either stamp', async () => {
    const { proof } = await capture(async ticket => {
      recordPublicHtmlRenderStamp(ticket, 'catalog', catalog, start + 12_000);
      recordPublicHtmlRenderStamp(ticket, 'filters', filters, start + 45_000);
      markPublicHtmlRenderComplete(ticket);
      return html('<html>Valid</html>');
    });
    expect(proof).toMatchObject({
      healthy: true,
      data: {
        catalog: { validUntil: expiresIn(12_000) },
        filters: { validUntil: expiresIn(12_000) },
      },
    });
  });

  it('bounds proof lifetimes by the negotiated protocol and the exchange-rate expiry', () => {
    const fiveMinutes = { ...catalog, fx: null, validUntil: expiresIn(300_000) };
    const tenMinutes = { ...fiveMinutes, validUntil: expiresIn(600_000) };
    expect(parsePublicHtmlCacheStamp(fiveMinutes, start, 2)).toEqual(fiveMinutes);
    expect(parsePublicHtmlCacheStamp({ ...fiveMinutes, validUntil: expiresIn(300_001) }, start, 2)).toBeNull();
    expect(parsePublicHtmlCacheStamp(tenMinutes, start, 2)).toBeNull();
    expect(parsePublicHtmlCacheStamp(tenMinutes, start, 3)).toEqual(tenMinutes);
    expect(parsePublicHtmlCacheStamp({ ...tenMinutes, validUntil: expiresIn(600_001) }, start, 3)).toBeNull();
    expect(parsePublicHtmlCacheStamp(tenMinutes, start + 600_000, 3)).toBeNull();
    expect(parsePublicHtmlCacheStamp({ ...tenMinutes, fx: catalog.fx }, start, 3)).toBeNull();
  });

  it('uses the accepted deadline for an authenticated protocol 3 render', async () => {
    const validUntil = expiresIn(600_000);
    const acceptedDeadline = start + 540_000;
    let renderTicket: string | null = null;
    const { proof } = await capturePublicHtmlRender(async ticket => {
      renderTicket = ticket;
      expect(publicHtmlRenderProtocol(ticket)).toBe(3);
      for (const [scope, stamp] of observations)
        recordPublicHtmlRenderStamp(ticket, scope, { ...stamp, fx: null, validUntil }, acceptedDeadline, 3);
      markPublicHtmlRenderComplete(ticket);
      return html('<html>Valid</html>');
    }, { now: () => start, protocol: 3 });
    expect(proof).toMatchObject({
      healthy: true,
      data: {
        catalog: { validUntil: expiresIn(540_000) },
        filters: { validUntil: expiresIn(540_000) },
      },
    });
    expect(publicHtmlRenderProtocol(renderTicket)).toBeUndefined();
  });

  it.each([[2, 3], [3, 2]] as const)('fails a protocol %s ticket after a protocol %s read', async (protocol, mismatched) => {
    const { proof, response } = await capturePublicHtmlRender(async ticket => {
      expect(publicHtmlRenderProtocol(ticket)).toBe(protocol);
      recordPublicHtmlRenderStamp(ticket, 'catalog', catalog, undefined, mismatched);
      for (const [scope, stamp] of observations)
        recordPublicHtmlRenderStamp(ticket, scope, stamp, undefined, protocol);
      markPublicHtmlRenderComplete(ticket);
      return html('<html>Uncached</html>');
    }, { now: () => start, protocol });
    expect(proof).toBeNull();
    expect(await response.text()).toBe('<html>Uncached</html>');
  });

  it('allows both dependencies to have the same null exchange-rate snapshot', async () => {
    const { proof } = await capture(async ticket => {
      for (const [scope, stamp] of observations)
        recordPublicHtmlRenderStamp(ticket, scope, { ...stamp, fx: null });
      markPublicHtmlRenderComplete(ticket);
      return html('<html>Valid</html>');
    });
    expect(proof).toMatchObject({ healthy: true, data: { catalog: { fx: null }, filters: { fx: null } } });
  });

  it.each([
    ['missing completion signal', observations, false],
    ['missing snapshots', [], true],
    ['missing filters', [observations[0]], true],
    ['missing catalog', [observations[1]], true],
    ['invalid observation followed by success', [['catalog', {}], ...observations], true],
    ['non-USD pricing', [['catalog', { ...catalog, priceView: 'original' }], observations[1]], true],
    ['changed version within a scope', [...observations, ['catalog', { ...catalog, version: 'd'.repeat(64) }]], true],
    ['different exchange-rate versions', [
      observations[0], ['filters', { ...filters, fx: { ...filters.fx, version: 'd0000000-0000-4000-8000-000000000001' } }],
    ], true],
    ['different exchange-rate expiries', [
      observations[0], ['filters', { ...filters, fx: { ...filters.fx, expiresAt: expiresIn(50_000) } }],
    ], true],
    ['stamp deadline beyond the exchange-rate expiry', [
      observations[0], ['filters', { ...filters, fx: { ...filters.fx, expiresAt: expiresIn(10_000) } }],
    ], true],
    ['inconsistent null exchange-rate snapshot', [observations[0], ['filters', { ...filters, fx: null }]], true],
  ] as const)('does not prove %s', async (_label, stamps, complete) => {
    const { proof, response } = await capture(async ticket => {
      for (const [scope, stamp] of stamps) recordPublicHtmlRenderStamp(ticket, scope, stamp);
      if (complete) markPublicHtmlRenderComplete(ticket);
      return html('<html>Fallback</html>');
    });
    expect(proof).toBeNull();
    expect(await response.text()).toBe('<html>Fallback</html>');
  });

  it('does not clear a handled failure when subsequent reads succeed', async () => {
    const { proof } = await capture(async ticket => {
      invalidatePublicHtmlRender(ticket);
      attest(ticket);
      return html('<html>Fallback</html>');
    });
    expect(proof).toBeNull();
  });

  it.each(['expired deadline', 'late render error'] as const)('does not attest a response after %s before EOF', async (failure) => {
    const stream = streamingHtml();
    let now = start;
    let renderTicket: string | null = null;
    const pending = capture(async ticket => {
      renderTicket = ticket;
      attest(ticket, expiresIn(500));
      return stream.response;
    }, () => now);

    stream.send('<html>Initial document');
    await nextTurn();
    if (failure === 'expired deadline') now += 500;
    else invalidatePublicHtmlRender(renderTicket);
    stream.send('</html>');
    stream.close();

    const { proof, response } = await pending;
    expect(proof).toBeNull();
    expect(await response.text()).toBe('<html>Initial document</html>');
  });

  it('propagates a transport failure after initial bytes', async () => {
    const stream = streamingHtml();
    const pending = capture(async ticket => {
      attest(ticket);
      return stream.response;
    });
    const transportFailure = new Error('Response transport stopped');
    const rejected = expect(pending).rejects.toBe(transportFailure);
    stream.send('<html>Partial');
    await nextTurn();
    stream.fail(transportFailure);
    await rejected;
  });

  it.each([
    ['not found', '<html>Not found</html>', { status: 404 }],
    ['rate limited', '<html>Wait</html>', { status: 429, headers: { 'Retry-After': '2' } }],
    ['non-HTML', '{}', { headers: { 'Content-Type': 'application/json' } }],
    ['Set-Cookie', '<html>Private</html>', { headers: { 'Set-Cookie': 'session=example' } }],
    ['compressed body', '<html>Encoded</html>', { headers: { 'Content-Encoding': 'gzip' } }],
    ['short body for announced length', '<html>Short</html>', { headers: { 'Content-Length': '30' } }],
    ['empty body', '', {}],
  ] as const)('does not prove a response with %s', async (_label, body, init) => {
    const { proof, response } = await capture(async ticket => {
      attest(ticket);
      return html(body, init);
    });
    expect(proof).toBeNull();
    expect(response.status).toBe('status' in init ? init.status : 200);
    expect(await response.text()).toBe(body);
  });

  it('replays an oversized response without waiting for the remaining body', async () => {
    const stream = streamingHtml();
    let settled = false;
    const pending = capture(async ticket => {
      attest(ticket);
      return stream.response;
    }).finally(() => { settled = true; });

    const prefix = '<html>' + 'x'.repeat(maxHtmlBytes - 6);
    stream.send(prefix);
    stream.send('车');
    await nextTurn();
    const settledBeforeEof = settled;
    stream.send('tail</html>');
    stream.close();
    const { proof, response } = await pending;

    expect(settledBeforeEof).toBe(true);
    expect(proof).toBeNull();
    const body = await response.text();
    expect(body.length).toBe(prefix.length + '车tail</html>'.length);
    expect(body.startsWith(prefix)).toBe(true);
    expect(body.endsWith('车tail</html>')).toBe(true);
  });

  it('bypasses a fifth concurrent capture and releases slots on completion', async () => {
    const release = deferred<void>();
    const tickets: Array<string | null> = [];
    const occupied = Array.from({ length: 4 }, () => capture(async ticket => {
      tickets.push(ticket);
      await release.promise;
      attest(ticket);
      return html('<html>Ready</html>');
    }));
    await nextTurn();
    let overflowTicket: string | null | undefined;
    const overflow = capture(async ticket => {
      overflowTicket = ticket;
      attest(ticket);
      return html('<html>Uncached</html>');
    });
    await nextTurn();
    const ticketBeforeRelease = overflowTicket;
    release.resolve();
    const [replies, fifth] = await Promise.all([Promise.all(occupied), overflow]);

    expect(tickets).not.toContain(null);
    expect(new Set(tickets).size).toBe(4);
    expect(ticketBeforeRelease).toBeNull();
    expect(fifth.proof).toBeNull();
    expect(await fifth.response.text()).toBe('<html>Uncached</html>');
    expect(replies.every(reply => reply.proof?.healthy)).toBe(true);
    const after = await capture(async ticket => {
      attest(ticket);
      return html('<html>Again</html>');
    });
    expect(after.proof?.healthy).toBe(true);
  });

  it('keeps oversized replay buffers bounded until the client cancels or consumes them', async () => {
    const captured = await Promise.all(Array.from({ length: 4 }, () => capture(async (ticket) => {
      attest(ticket);
      return html('x'.repeat(maxHtmlBytes + 1));
    })));
    try {
      const extras = await capture(async (ticket) => {
        expect(ticket).toBeNull();
        return html('<html>Bypassed</html>');
      });
      expect(extras.proof).toBeNull();
      await captured[0].response.body?.cancel();
      const next = await capture(async (ticket) => {
        attest(ticket);
        return html('<html>Ready</html>');
      });
      expect(next.proof?.healthy).toBe(true);
    } finally {
      await Promise.all(captured.map(({ response }) => response.body?.cancel()));
    }
  });
});
