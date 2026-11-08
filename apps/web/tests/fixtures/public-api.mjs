/** Isolated HTTP fixtures for the website. Never points at a database or operating inventory. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import {
  ApiErrorSchema,
  IdSchema,
  PublicFilterQuerySchema,
  PublicHomeSectionsSchema,
  PublicLocaleQuerySchema,
  PublicMediaQuerySchema,
  PublicVehicleFiltersSchema,
  PublicVehicleListSchema,
  PublicVehicleResponseSchema,
  PublicVehicleSchema,
  PublicVehicleQuerySchema,
} from '@hd/contracts/public';

export const fixtureSuite = 'hd-web-public-catalog-v1';
const timestamp = '2026-11-08T00:00:00Z';
// Independent deterministic originals and small previews; no remote images or image library.
const imageCache = new Map();
function pngChunk(type, data) {
  const name = Buffer.from(type), payload = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); payload.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return chunk;
}
function imageBytes(id, thumbnail) {
  const key = `${id}:${thumbnail}`;
  if (imageCache.has(key)) return imageCache.get(key);
  const width = thumbnail ? 120 : 640, height = thumbnail ? 80 : 420;
  const seed = [...id].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    const stripe = Math.floor((x + y) / Math.max(1, width / 8)) % 2 ? 55 : 0;
    pixels[offset] = 40 + (seed % 130) + stripe;
    pixels[offset + 1] = 40 + ((seed >>> 8) % 130) + stripe;
    pixels[offset + 2] = 40 + ((seed >>> 16) % 130) + stripe;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
  imageCache.set(key, png);
  return png;
}
const localized = {
  zh: {
    demo: '展示车型 Alpha',
    manual: '精选车型',
    future: '新发布车型',
    external: '外部来源测试车型',
    first: '配置精选',
    second: '最新精选',
  },
  en: {
    demo: 'Showcase Alpha',
    manual: 'Selected vehicle',
    future: 'Newly published vehicle',
    external: 'External source test vehicle',
    first: 'Configured selection',
    second: 'Recent selection',
  },
  ru: {
    demo: 'Образец Alpha',
    manual: 'Подобранный автомобиль',
    future: 'Новый опубликованный автомобиль',
    external: 'Тестовый автомобиль внешнего источника',
    first: 'Подборка из настроек',
    second: 'Новые автомобили',
  },
};
function publicText(text, locale, reviewed = true) {
  return { text, requestedLocale: locale, contentLocale: locale, kind: 'human', reviewed };
}
function vehicle(id, locale, overrides = {}) {
  const base = makePublicVehicleFixture();
  const demo = id === 'fixture_demo';
  const external = id === 'fixture_external';
  const index = Number(id.match(/_(\d+)$/)?.[1] ?? 0);
  const beta = index % 2 === 1;
  const facts = {
    ...base.facts,
    make: { id: beta ? 'beta' : 'alpha', name: beta ? 'Beta Motors' : 'Alpha Motors' },
    model: { id: beta ? 'beta_model' : 'alpha_model', name: beta ? 'Beta Model' : 'Alpha Model' },
    powertrain: beta ? 'petrol' : 'bev',
    manufacturedAt: null,
    firstRegistration: null,
    mileageKm: null,
    ...(demo
      ? {
          location: null,
          registrationStatus: 'unknown',
          modelYear: null,
          engineCc: null,
          powerKw: null,
          body: null,
          transmission: null,
        }
      : {}),
  };
  const title = demo
    ? localized[locale].demo
    : id === 'fixture_future'
      ? localized[locale].future
      : external ? localized[locale].external : `${localized[locale].manual} ${id}`;
  return PublicVehicleSchema.parse({
    ...base,
    id,
    stockCode: demo ? 'SHOW-ALPHA' : id === 'fixture_future' ? 'HD-FUTURE-01' : `HD-${id}`,
    source: external ? { kind: 'external', platform: { id: 'fixture_market', name: 'Fixture Marketplace' }, listingUrl: 'https://example.invalid/listings/fixture-external' } : { kind: demo ? 'demo' : 'manual' },
    facts,
    price: demo ? { kind: 'on_request', money: null, includes: [] } : external ? { kind: 'reference', money: base.price.money, includes: [] } : base.price,
    content: {
      title: publicText(title, locale, !demo && !external),
      description: publicText(`${title} — HTTP fixture only.`, locale, !demo && !external),
    },
    images: Array.from({length: 4}, (_, imageIndex) => {
      const mediaId = `media_${id}${imageIndex ? `_${imageIndex + 1}` : ''}`;
      return { id: mediaId, url: `/api/v1/media/${mediaId}`, alt: `${title} fixture photo ${imageIndex + 1}`, width: 640, height: 420, sortOrder: imageIndex, isCover: imageIndex === 0 };
    }),
    availability: demo || external
      ? 'unknown'
      : id === 'fixture_reserved'
        ? 'reserved'
        : id === 'fixture_sold'
          ? 'sold'
          : 'available',
    availabilityCheckedAt: demo || external || overrides.availability === 'unknown' ? null : timestamp,
    detailPath: `/${locale}/cars/${id}/`,
    ...overrides,
  });
}
const resetState = () => ({
  mode: 'normal',
  sectionCount: 1,
  futurePublished: false,
  futureAvailability: 'available',
  futureArchived: false,
  filtersUnavailable: false,
  externalPublished: false,
  responseDelayMs: 0,
  publicRateLimited: false,
  filtersRateLimited: false,
});
function visibleVehicles(state, locale) {
  if (state.mode === 'empty') return [];
  const rows = [
    vehicle('fixture_demo', locale),
    ...Array.from({ length: 24 }, (_, i) => vehicle(`fixture_car_${i + 1}`, locale)),
    vehicle('fixture_reserved', locale),
  ];
  if (state.futurePublished && !state.futureArchived && state.futureAvailability !== 'sold')
    rows.unshift(vehicle('fixture_future', locale, { availability: state.futureAvailability }));
  if (state.externalPublished) rows.push(vehicle('fixture_external', locale));
  return rows;
}
// Mirrors public SQL strpos: the whole query is literal, fields are OR; selectors AND it.
function searchMatches(row, q) {
  const needle = q?.trim().toLocaleLowerCase();
  return !needle || [row.content.title.text, row.stockCode, row.facts.make?.name, row.facts.model?.name]
    .some((text) => text?.toLocaleLowerCase().includes(needle));
}
function error(code, retryable = false) {
  return ApiErrorSchema.parse({
    error: { code, message: 'Isolated fixture response', retryable },
    meta: { requestId: `fixture-${code}` },
  });
}
function send(res, status, value, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error('Fixture control body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** Only loopback, optional ephemeral port, and in-memory state. */
export async function startPublicFixtureApi({ port = 3327 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || port === 3320)
    throw new Error('Use a dedicated fixture port, never API 3320.');
  let state = resetState();
  let requests = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/__fixtures/health' && req.method === 'GET')
        return send(res, 200, { suite: fixtureSuite });
      if (url.pathname === '/__fixtures/reset' && req.method === 'POST') {
        state = resetState();
        requests = [];
        return send(res, 200, { suite: fixtureSuite, state });
      }
      if (url.pathname === '/__fixtures/state' && req.method === 'PUT') {
        const patch = await body(req);
        const validators = {
          mode: (v) => ['normal', 'empty', 'unavailable', 'malformed'].includes(v),
          sectionCount: (v) => [0, 1, 2].includes(v),
          futurePublished: (v) => typeof v === 'boolean',
          futureAvailability: (v) => ['available', 'reserved', 'sold', 'unknown'].includes(v),
          futureArchived: (v) => typeof v === 'boolean',
          filtersUnavailable: (v) => typeof v === 'boolean',
          externalPublished: (v) => typeof v === 'boolean',
          responseDelayMs: (v) => Number.isInteger(v) && v >= 0 && v <= 5000,
          publicRateLimited: (v) => typeof v === 'boolean',
          filtersRateLimited: (v) => typeof v === 'boolean',
        };
        if (
          !patch ||
          Array.isArray(patch) ||
          typeof patch !== 'object' ||
          Object.entries(patch).some(
            ([key, value]) => !Object.hasOwn(validators, key) || !validators[key](value),
          )
        )
          return send(res, 400, error('INVALID_REQUEST'));
        state = { ...state, ...patch };
        return send(res, 200, { suite: fixtureSuite, state });
      }
      if (url.pathname === '/__fixtures/requests' && req.method === 'GET')
        return send(res, 200, { suite: fixtureSuite, requests });
      if (url.pathname.startsWith('/api/v1/')) {
        requests.push({
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          cookie: req.headers.cookie ?? null,
          authorization: req.headers.authorization ?? null,
        });
        if (requests.length > 1000) requests.shift();
      }
      if (req.method !== 'GET') return send(res, 405, error('INVALID_REQUEST'));
      let catalogQuery, filterQuery, mediaQuery;
      let locale = 'ru';
      if (url.pathname.startsWith('/api/v1/')) {
        const raw = Object.fromEntries(url.searchParams);
        if ([...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1))
          return send(res, 400, error('INVALID_REQUEST'));
        const rawId = url.pathname.match(/^\/api\/v1\/(?:vehicles|media)\/(.*)$/)?.[1];
        if (rawId !== undefined && !IdSchema.safeParse(rawId).success)
          return send(res, 400, error('INVALID_REQUEST'));
        try {
          if (url.pathname.startsWith('/api/v1/media/')) mediaQuery = PublicMediaQuerySchema.parse(raw);
          else if (url.pathname === '/api/v1/vehicles') {
            catalogQuery = PublicVehicleQuerySchema.parse({ ...raw, page: raw.page === undefined ? undefined : Number(raw.page), pageSize: raw.pageSize === undefined ? undefined : Number(raw.pageSize) });
            locale = catalogQuery.locale;
          } else if (url.pathname === '/api/v1/vehicle-filters') {
            filterQuery = PublicFilterQuerySchema.parse(raw); locale = filterQuery.locale;
          } else locale = PublicLocaleQuerySchema.parse(raw).locale;
        } catch { return send(res, 400, error('INVALID_REQUEST')); }
        if (state.responseDelayMs && !url.pathname.startsWith('/api/v1/media/'))
          await new Promise((resolve) => setTimeout(resolve, state.responseDelayMs));
      }
      // A fixed short Retry-After exercises browser cooldown without changing the real API limiter.
      // Media and facets stay readable; validation above still rejects malformed requests as 400.
      if (state.publicRateLimited && (
        url.pathname === '/api/v1/home/vehicles' || url.pathname === '/api/v1/vehicles' ||
        /^\/api\/v1\/vehicles\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(url.pathname)
      )) return send(res, 429, error('RATE_LIMITED', true), { 'retry-after': '2' });
      if (state.filtersRateLimited && url.pathname === '/api/v1/vehicle-filters')
        return send(res, 429, error('RATE_LIMITED', true), { 'retry-after': '2' });
      if (state.filtersUnavailable && url.pathname === '/api/v1/vehicle-filters')
        return send(res, 503, error('SERVICE_UNAVAILABLE', true));
      if (state.mode === 'unavailable' && url.pathname.startsWith('/api/v1/'))
        return send(res, 503, error('SERVICE_UNAVAILABLE', true));
      if (
        state.mode === 'malformed' &&
        url.pathname.startsWith('/api/v1/') &&
        !url.pathname.startsWith('/api/v1/media/')
      )
        return send(res, 200, { badFixture: true });
      const all = visibleVehicles(state, locale);
      if (url.pathname === '/api/v1/home/vehicles') {
        const sections =
          state.sectionCount > 0 && all.length
            ? [
                {
                  id: 'featured',
                  title: localized[locale].first,
                  vehicles: all
                    .filter((v) => v.source.kind === 'demo' || v.availability === 'available')
                    .slice(0, 3),
                },
              ]
            : [];
        if (state.sectionCount === 2 && all.length)
          sections.push({
            id: 'recent',
            title: localized[locale].second,
            vehicles: all
              .filter((v) => v.source.kind === 'demo' || v.availability === 'available')
              .slice(3, 4),
          });
        return send(
          res,
          200,
          PublicHomeSectionsSchema.parse({
            data: { sections },
            meta: { requestId: 'fixture-home' },
          }),
        );
      }
      if (url.pathname === '/api/v1/vehicles') {
        const { page, pageSize, make, model, powertrain, q } = catalogQuery;
        const filtered = all.filter(
          (v) =>
            searchMatches(v, q) && (!make || v.facts.make?.id === make) &&
            (!model || v.facts.model?.id === model) && (!powertrain || v.facts.powertrain === powertrain),
        );
        return send(
          res,
          200,
          PublicVehicleListSchema.parse({
            data: {
              items: filtered.slice((page - 1) * pageSize, page * pageSize),
              page,
              pageSize,
              hasMore: page * pageSize < filtered.length,
            },
            meta: {
              requestId: 'fixture-list',
              catalog: 'curated',
              total: filtered.length,
              totalKind: 'exact',
              accessibleTotal: filtered.length,
              dataAsOf: timestamp,
              freshness: 'fresh',
            },
          }),
        );
      }
      if (url.pathname === '/api/v1/vehicle-filters') {
        const searched = all.filter((v) => searchMatches(v, filterQuery.q));
        const makes = ['alpha', 'beta']
          .map((id) => ({
            id,
            name: `${id === 'alpha' ? 'Alpha' : 'Beta'} Motors`,
            count: searched.filter((v) => v.facts.make?.id === id).length,
          }))
          .filter((v) => v.count);
        return send(
          res,
          200,
          PublicVehicleFiltersSchema.parse({
            data: {
              catalog: 'curated',
              makes,
              models: makes.map(({ id, count }) => ({
                id: `${id}_model`,
                makeId: id,
                name: `${id === 'alpha' ? 'Alpha' : 'Beta'} Model`,
                count,
              })),
              powertrains: ['bev', 'petrol']
                .map((id) => ({ id, count: searched.filter((v) => v.facts.powertrain === id).length }))
                .filter((v) => v.count),
            },
            meta: { requestId: 'fixture-filters' },
          }),
        );
      }
      const detailId = url.pathname.match(/^\/api\/v1\/vehicles\/([A-Za-z0-9_-]+)$/)?.[1];
      if (detailId) {
        const found =
          all.find((v) => v.id === detailId) ??
          (detailId === 'fixture_sold'
            ? vehicle(detailId, locale)
            : detailId === 'fixture_future' && state.futurePublished && !state.futureArchived
              ? vehicle(detailId, locale, { availability: state.futureAvailability })
              : null);
        return found
          ? send(
              res,
              200,
              PublicVehicleResponseSchema.parse({
                data: found,
                meta: { requestId: 'fixture-detail' },
              }),
            )
          : send(res, 404, error('NOT_FOUND'));
      }
      const mediaId = url.pathname.match(/^\/api\/v1\/media\/([A-Za-z0-9_-]+)$/)?.[1];
      if (mediaId) {
        const readable = [...all, vehicle('fixture_sold', locale), ...(state.futurePublished && !state.futureArchived ? [vehicle('fixture_future', locale)] : [])];
        const referenced = readable.some((v) => v.images.some((image) => image.id === mediaId));
        if (!referenced) return send(res, 404, error('NOT_FOUND'));
        const png = imageBytes(mediaId, mediaQuery?.variant === 'thumb');
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': png.length,
          'cache-control': 'no-store',
          'set-cookie': 'fixture-upstream-private-marker=do-not-forward; HttpOnly',
          'x-fixture-internal': 'must-not-forward',
        });
        return res.end(png);
      }
      return send(res, 404, error('NOT_FOUND'));
    } catch (caught) {
      console.error(
        'Fixture request failed:',
        caught instanceof Error ? caught.message : 'unknown',
      );
      if (!res.headersSent) send(res, 500, error('INTERNAL_ERROR'));
      else res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const portArg = process.argv.indexOf('--port');
  const port = Number(portArg === -1 ? 3327 : process.argv[portArg + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3320)
    throw new Error('Use a dedicated fixture port, never API 3320.');
  const instance = await startPublicFixtureApi({ port });
  console.log(`${fixtureSuite} listening at ${instance.origin}`);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => instance.close().then(() => process.exit(0)));
}
