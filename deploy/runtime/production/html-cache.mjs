import { randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { createServer, Agent, request as requestHttp } from 'node:http';
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { createBrowseCache } from './browse-cache.mjs';

const protocolMaxAge = new Map([['2', 300_000], ['3', 600_000], ['4', 600_000]]);
const MAX_HTML = 512 * 1024;
const MAX_CONTROL = 8192;
const MAX_LOOKUPS = 8;
const MAX_BROWSE_FALLBACKS = 8;
const protocol = 'x-hd-cache-protocol';
const keyHeader = 'x-hd-html-key';
const nonceHeader = 'x-hd-html-nonce';
const proofHeader = 'x-hd-html-proof';
const targetHeader = 'x-hd-render-target';
const generationHeader = 'x-hd-browse-generation';
const homepage = /^\/(zh|en|ru)\/$/;
const directory = /^\/(zh|en|ru)\/cars\/$/;
const directoryQuery = new Set([
  'catalog', 'locale', 'view', 'priceView', 'projection', 'q', 'sort', 'make', 'model', 'generation', 'trim',
  'powertrain', 'drivetrain', 'priceMin', 'priceMax', 'priceCurrency', 'mileageMin', 'mileageMax',
  'yearMin', 'yearMax', 'page', 'pageSize',
]);
const varyHeaders = new Set([
  'accept', 'accept-encoding', 'rsc', 'next-router-state-tree',
  'next-router-prefetch', 'next-router-segment-prefetch',
]);
const bypassHeaders = [
  'cookie', 'authorization', 'proxy-authorization', 'rsc', 'next-router-state-tree',
  'next-router-prefetch', 'next-router-segment-prefetch', 'next-url', 'next-action', 'purpose', 'sec-purpose',
  'x-middleware-prefetch', 'range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since', 'if-range',
];
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'];
const reusableResponseHeaders = ['content-type', 'content-language', 'vary', 'link',
  'content-security-policy', 'content-security-policy-report-only',
  'cross-origin-embedder-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy',
  'permissions-policy', 'referrer-policy', 'x-content-type-options', 'x-frame-options', 'x-robots-tag'];

const parts = (value) => (typeof value === 'string' ? value : '').toLowerCase().split(',').map(part => part.trim());
const controlHeader = (name) => /^x-hd-(?:cache-|html-|public-html-|browse-|catalog-scope$|render-target$|ssr-key$|client-ip$)/.test(name);
const ascii = (value, pattern) => typeof value === 'string' && pattern.test(value);
const time = (value) => ascii(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/) ? Date.parse(value) : NaN;
const hexVersion = (value) => ascii(value, /^[a-f0-9]{64}$/);
const uuid = (value) => ascii(value, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const privateKey = /^[\x21-\x7e]{32,256}$/;
const compressHtml = promisify(gzip);

export function readHtmlCacheKey(file) {
  let fd;
  try {
    if (!file || file.length > 1024 || !isAbsolute(file)) throw new Error();
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 258) throw new Error();
    const bytes = Buffer.alloc(259);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    const key = bytes.subarray(0, size).toString('latin1').replace(/\r?\n$/, '');
    if (size > 258 || !privateKey.test(key)) throw new Error();
    return key;
  } catch {
    throw new Error('Use a regular owner-only HTML cache key file');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function readBrowseGeneration(file) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || (info.mode & 0o022) !== 0 || info.size !== 33) return null;
    const value = Buffer.alloc(34);
    if (readSync(fd, value, 0, value.length, null) !== 33) return null;
    return /^([a-f0-9]{32})\n$/u.exec(value.subarray(0, 33).toString('latin1'))?.[1] ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function browseTarget(url) {
  if (!ascii(url, /^[\x21-\x7e]{1,1800}$/u) || url.includes('#')) return null;
  if (homepage.test(url)) return url;
  const at = url.indexOf('?');
  if (at < 0) return directory.test(url) ? url : null;
  const path = url.slice(0, at);
  if (!directory.test(path)) return null;
  const fields = url.slice(at + 1).split('&');
  const seen = new Set();
  for (const field of fields) {
    const equals = field.indexOf('=');
    const name = field.slice(0, equals);
    if (equals < 1 || !directoryQuery.has(name) || seen.has(name)) return null;
    try { decodeURIComponent(field.slice(equals + 1)); } catch { return null; }
    seen.add(name);
  }
  // Preserve value bytes and explicit defaults. Only unique parameter order is normalized.
  return path + '?' + fields.sort().join('&');
}

function forwarded(headers) {
  const blocked = new Set([...hopHeaders, ...parts(headers.connection)]);
  return Object.fromEntries(Object.entries(headers)
    .filter(([name]) => !blocked.has(name) && !controlHeader(name)));
}

function encodingPreferences(value) {
  const weights = new Map();
  for (const term of parts(value)) {
    const coding = term.split(';', 1)[0].trim();
    if (coding !== 'gzip' && coding !== 'identity' && coding !== '*') continue;
    const quality = /^(?:gzip|identity|\*)\s*(?:;\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/.exec(term);
    const weight = quality ? Number(quality[1] ?? 1) : 0;
    weights.set(coding, Math.min(weights.get(coding) ?? 1, weight));
  }
  const wildcard = weights.get('*');
  return {
    identity: weights.get('identity') ?? (wildcard === 0 ? 0 : 1),
    gzip: weights.get('gzip') ?? wildcard ?? 0,
  };
}

function eligible(request, encoding) {
  const headers = request.headers;
  // A normal reload can use the same live version check as a navigation. Hard
  // reloads still go directly to the origin, which also owns conditional responses.
  return !bypassHeaders.some(name => Object.hasOwn(headers, name)) &&
    parts(headers.accept).some(term => /^text\/html(?:\s*;|$)/.test(term) && !/;\s*q=0(?:\.0*)?(?:;|$)/.test(term)) &&
    encoding.identity > 0 &&
    !parts(headers['cache-control']).some(term => /^(?:no-cache|no-store|no-transform)(?:\s*=|$)/.test(term)) &&
    !parts(headers.pragma).includes('no-cache') &&
    isIP(headers['x-hd-visitor-ip']) > 0;
}

// The opaque scope versions already bind recovery epoch and the scope's
// revision. Both live scopes and both actually rendered scopes are mandatory.
function readSnapshot(value, release, nonce, now, tick, maxAge, render) {
  if (!value || value.release !== release || value.nonce !== nonce ||
      (render && value.healthy !== true) || !value.data ||
      Object.keys(value.data).sort().join(',') !== 'catalog,filters') return null;

  const stamps = [value.data.catalog, value.data.filters];
  const signatures = [];
  let deadline = Infinity;
  for (const stamp of stamps) {
    if (!stamp || stamp.priceView !== 'usd' || !hexVersion(stamp.version)) return null;
    const checkedAt = time(stamp.checkedAt);
    const validUntil = time(stamp.validUntil);
    if (!(checkedAt <= now + 5000 && validUntil > Math.max(now, checkedAt) && validUntil - checkedAt <= maxAge))
      return null;
    if (stamp.fx !== null && (!uuid(stamp.fx?.version) || !(time(stamp.fx.expiresAt) >= validUntil))) return null;
    const fx = stamp.fx === null ? null : [stamp.fx.version, time(stamp.fx.expiresAt)];
    signatures.push([stamp.version, fx]);
    deadline = Math.min(deadline, validUntil);
  }
  if (signatures[0][0] === signatures[1][0] ||
      JSON.stringify(signatures[0][1]) !== JSON.stringify(signatures[1][1])) return null;
  return { signature: JSON.stringify(signatures), deadline, elapsedDeadline: tick + deadline - now };
}

function singleHeader(source, header) {
  const values = [];
  for (let i = 0; i < source.length; i += 2) {
    if (source[i].toLowerCase() === header) values.push(source[i + 1]);
  }
  return values.length === 1 ? values[0] : undefined;
}

function proof(response, release, nonce, now, tick, maxAge) {
  const supplied = singleHeader(response.rawHeaders, proofHeader);
  if (!response.complete || !ascii(supplied, /^[a-zA-Z0-9_-]{1,8192}$/) ||
      response.trailers[proofHeader] || response.trailers['set-cookie']) return null;
  try {
    return readSnapshot(JSON.parse(Buffer.from(supplied, 'base64url')), release, nonce, now, tick, maxAge, true);
  } catch {
    return null;
  }
}

function browseProof(response, identity) {
  const supplied = singleHeader(response.rawHeaders, proofHeader);
  if (!response.complete || !ascii(supplied, /^[a-zA-Z0-9_-]{1,4096}$/) ||
      response.trailers[proofHeader] || response.trailers['set-cookie']) return null;
  try {
    const value = JSON.parse(Buffer.from(supplied, 'base64url'));
    const { release, nonce, generation, target } = identity;
    if (value?.healthy !== true || value.release !== release || value.nonce !== nonce ||
        value.generation !== generation || value.target !== target) return null;
    return { observedAt: value.observedAt, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

function cacheable(response) {
  const h = response.headers;
  return response.statusCode === 200 && /^text\/html(?:;|$)/i.test(h['content-type'] ?? '') &&
    !Object.hasOwn(h, 'set-cookie') && !h['content-range'] &&
    (!h['content-encoding'] || h['content-encoding'] === 'identity') &&
    !parts(h['cache-control']).some(part => /^(?:private|no-transform)(?:\s*=|$)/.test(part)) &&
    parts(h.vary).every(name => !name || varyHeaders.has(name)) &&
    !/['"]nonce-/i.test((h['content-security-policy'] ?? '') + (h['content-security-policy-report-only'] ?? '')) &&
    (!h['content-length'] || Number(h['content-length']) <= MAX_HTML);
}

function open(origin, path, headers, signal, agent) {
  return new Promise((resolve, reject) => {
    const request = requestHttp(origin, { path, headers, signal, agent }, resolve);
    request.once('error', reject);
    request.end();
  });
}

async function boundedBody(response, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > maxBytes) return null;
    chunks.push(chunk);
  }
  return response.complete ? Buffer.concat(chunks, bytes) : null;
}

function throttled(response) {
  if (response.statusCode !== 429) return null;
  const supplied = response.headers['retry-after'];
  response.destroy();
  return { retryAfter: ascii(supplied, /^(?:0|[1-9]\d{0,8})$/) ? supplied : '1' };
}

export function createHtmlCacheServer({ origin, siteHost, edgeIp, release, secret, cacheProtocol = '2',
  readGeneration, now = Date.now, tick = () => performance.now() }) {
  const maxAge = protocolMaxAge.get(cacheProtocol);
  if (!ascii(release, /^[a-f0-9]{40}$/) || !ascii(secret, privateKey) || !isIP(edgeIp) ||
      origin.protocol !== 'http:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      !ascii(siteHost, /^[a-z0-9.-]+$/) || maxAge === undefined ||
      (cacheProtocol === '4' && (siteHost !== 'hongdingauto.com' || typeof readGeneration !== 'function')))
    throw new Error('Invalid HTML cache configuration');

  const browse = cacheProtocol === '4' ? createBrowseCache({ readGeneration, now, tick }) : null;
  const pages = new Map(); // Exactly three canonical, queryless homepage keys per release process.
  const agent = new Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 8 });
  let activeLookups = 0;
  let activeBrowseFallbacks = 0;

  function trustedHeaders(visitor, nonce) {
    return {
      host: siteHost, 'x-forwarded-host': siteHost, 'x-forwarded-proto': 'https',
      'x-hd-visitor-ip': visitor, 'x-forwarded-for': visitor,
      'cache-control': 'no-store', [protocol]: cacheProtocol, [keyHeader]: secret, [nonceHeader]: nonce,
    };
  }

  async function currentVersion(path, visitor, disconnect) {
    const nonce = randomBytes(16).toString('hex');
    const signal = AbortSignal.any([disconnect, AbortSignal.timeout(1000)]);
    const response = await open(origin, '/internal/public-html/version/?locale=' + path.slice(1, -1), {
      ...trustedHeaders(visitor, nonce), accept: 'application/json',
    }, signal, agent);
    const limit = throttled(response);
    if (limit) return limit;
    if (response.statusCode !== 200 || singleHeader(response.rawHeaders, protocol) !== cacheProtocol ||
        !parts(response.headers['cache-control']).includes('no-store') ||
        !/^application\/json(?:;|$)/i.test(response.headers['content-type'] ?? '')) {
      response.destroy();
      return null;
    }
    const body = await boundedBody(response, MAX_CONTROL);
    return body && readSnapshot(JSON.parse(body), release, nonce, now(), tick(), maxAge, false);
  }

  async function privateRender(path, visitor, disconnect) {
    const nonce = randomBytes(16).toString('hex');
    const signal = AbortSignal.any([disconnect, AbortSignal.timeout(8000)]);
    const response = await open(origin, '/internal/public-html/render/', {
      ...trustedHeaders(visitor, nonce), accept: 'text/html', 'accept-encoding': 'identity', [targetHeader]: path,
    }, signal, agent);
    const limit = throttled(response);
    if (limit) return limit;
    if (!cacheable(response) || singleHeader(response.rawHeaders, protocol) !== cacheProtocol) {
      response.destroy();
      return null;
    }
    const body = await boundedBody(response, MAX_HTML);
    if (!body?.length) return null;
    const stamp = proof(response, release, nonce, now(), tick(), maxAge);
    const headers = stamp ? Object.fromEntries(reusableResponseHeaders
      .filter(name => Object.hasOwn(response.headers, name)).map(name => [name, response.headers[name]]))
      : forwarded(response.headers);
    return { stamp, headers: { ...headers, 'cache-control': 'no-store' }, body };
  }

  async function browseRender(target, visitor, generation) {
    const nonce = randomBytes(16).toString('hex');
    const response = await open(origin, '/internal/public-html/browse/', {
      ...trustedHeaders(visitor, nonce), accept: 'text/html', 'accept-encoding': 'identity',
      [targetHeader]: target, [generationHeader]: generation,
    }, AbortSignal.timeout(8000), agent);
    const limit = throttled(response);
    if (limit) return limit;
    if (!cacheable(response) || singleHeader(response.rawHeaders, protocol) !== cacheProtocol ||
        !parts(response.headers['cache-control']).includes('no-store')) {
      response.destroy();
      return null;
    }
    const body = await boundedBody(response, MAX_HTML);
    const stamp = body?.length && browseProof(response, { release, nonce, generation, target });
    if (!stamp) return null;
    const headers = Object.fromEntries(reusableResponseHeaders
      .filter(name => Object.hasOwn(response.headers, name)).map(name => [name, response.headers[name]]));
    return { ...stamp, body, headers: { ...headers, 'cache-control': 'no-store' } };
  }

  function sendPage(reply, page, preferGzip = false, cacheHit = false) {
    if (reply.destroyed) return;
    const compressed = preferGzip && page.gzipBody;
    const body = compressed || page.body;
    const headers = { ...page.headers, 'content-length': body.length };
    if (compressed) headers['content-encoding'] = 'gzip';
    if (cacheHit) headers['x-hd-cache-document'] = 'hit';
    reply.writeHead(200, headers).end(body);
  }

  function sendLimit(reply, limit) {
    reply.writeHead(429, { 'cache-control': 'no-store', 'retry-after': limit.retryAfter }).end();
  }

  function sendBusy(reply) {
    reply.writeHead(503, { 'cache-control': 'no-store', 'retry-after': '1' }).end();
  }

  async function serve(request, reply) {
    const host = request.headers.host?.toLowerCase();
    if (request.socket.remoteAddress !== edgeIp || (host !== siteHost && host !== siteHost + ':443')) {
      reply.writeHead(404, { 'cache-control': 'no-store' }).end();
      return;
    }
    const path = request.url.split('?')[0];
    if (!(homepage.test(path) || (browse && directory.test(path))) || request.method !== 'GET' ||
        request.headers['content-length'] || request.headers['transfer-encoding']) {
      reply.writeHead(502, { 'cache-control': 'no-store' }).end();
      return;
    }
    const disconnect = new AbortController();
    reply.once('close', () => { if (!reply.writableFinished) disconnect.abort(); });
    const initialTick = tick();
    const visitor = request.headers['x-hd-visitor-ip'];
    const encoding = encodingPreferences(request.headers['accept-encoding']);
    const preferGzip = encoding.gzip > 0 && encoding.gzip >= encoding.identity;
    const lookup = !browse && request.url === path && eligible(request, encoding) && activeLookups < MAX_LOOKUPS;
    if (lookup) activeLookups++;
    let browseFallback = false;
    try {
      const destination = request.headers['sec-fetch-dest'];
      const rscAccept = parts(request.headers.accept).some(value => /^text\/x-component(?:\s*;|$)/.test(value));
      const target = browse && !rscAccept && (!destination || destination === 'document') && eligible(request, encoding)
        ? browseTarget(request.url) : null;
      if (target) {
        const rendered = await browse.read(target, generation => browseRender(target, visitor, generation));
        if (rendered?.unavailable) {
          sendBusy(reply);
          return;
        }
        if (rendered?.retryAfter) {
          sendLimit(reply, rendered);
          return;
        }
        if (rendered) {
          sendPage(reply, rendered.value, false, rendered.hit);
          return;
        }
        if (activeBrowseFallbacks >= MAX_BROWSE_FALLBACKS) {
          sendBusy(reply);
          return;
        }
        browseFallback = true;
        activeBrowseFallbacks++;
      }
      if (lookup) {
        let live = null;
        try { live = await currentVersion(path, visitor, disconnect.signal); }
        catch { /* An unavailable control read always renders dynamically. */ }
        if (live?.retryAfter) {
          sendLimit(reply, live);
          return;
        }
        if (live) {
          const cached = pages.get(path);
          if (cached && cached.signature === live.signature &&
              Math.min(cached.deadline, live.deadline) > now() &&
              Math.min(cached.elapsedDeadline, live.elapsedDeadline) > tick()) {
            sendPage(reply, cached, preferGzip, true);
            return;
          }

          let rendered = null;
          try { rendered = await privateRender(path, visitor, disconnect.signal); }
          catch { /* A truncated or unavailable private render falls back to normal Web. */ }
          if (rendered?.retryAfter) {
            sendLimit(reply, rendered);
            return;
          }
          if (rendered) {
            const stamp = rendered.stamp;
            if (stamp?.signature === live.signature) {
              const deadline = Math.min(live.deadline, stamp.deadline);
              const elapsedDeadline = Math.min(initialTick + maxAge, live.elapsedDeadline, stamp.elapsedDeadline);
              const gzipBody = await compressHtml(rendered.body, { level: 4 }).catch(() => null);
              const latest = pages.get(path);
              // Another lookup may publish a newer revision while this request renders or compresses.
              if ((!latest || latest === cached || latest.signature === stamp.signature) &&
                  deadline > now() && elapsedDeadline > tick()) {
                const vary = rendered.headers.vary;
                const headers = { ...rendered.headers, vary: parts(vary).includes('accept-encoding')
                  ? vary : [vary, 'Accept-Encoding'].filter(Boolean).join(', ') };
                const page = { signature: stamp.signature, deadline, elapsedDeadline, headers, body: rendered.body, gzipBody };
                pages.set(path, page);
                sendPage(reply, page, preferGzip);
                return;
              }
            } else {
              sendPage(reply, rendered);
              return;
            }
          }
        }
      }

      const source = await open(origin, request.url, forwarded(request.headers),
        AbortSignal.any([disconnect.signal, AbortSignal.timeout(20_000)]), agent);
      if (browseFallback && (source.statusCode === 502 || source.statusCode === 504)) {
        source.destroy();
        sendBusy(reply);
        return;
      }
      reply.writeHead(source.statusCode, { ...forwarded(source.headers), 'cache-control': 'no-store' });
      await pipeline(source, reply);
    } catch {
      if (reply.headersSent) reply.destroy();
      else if (!reply.destroyed && browseFallback) sendBusy(reply);
      else if (!reply.destroyed) reply.writeHead(502, { 'cache-control': 'no-store' }).end();
    } finally {
      if (lookup) activeLookups--;
      if (browseFallback) activeBrowseFallbacks--;
    }
  }

  const server = createServer({ headersTimeout: 8000, requestTimeout: 15_000, maxHeaderSize: 16_384 }, serve);
  server.maxConnections = 128;
  server.on('close', () => agent.destroy());
  return server;
}
