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
  const name = Buffer.from(type),
    payload = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return chunk;
}
function imageBytes(id, thumbnail) {
  const key = `${id}:${thumbnail}`;
  if (imageCache.has(key)) return imageCache.get(key);
  const width = thumbnail ? 120 : 640,
    height = thumbnail ? 80 : 420;
  const seed = [...id].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      const stripe = Math.floor((x + y) / Math.max(1, width / 8)) % 2 ? 55 : 0;
      pixels[offset] = 40 + (seed % 130) + stripe;
      pixels[offset + 1] = 40 + ((seed >>> 8) % 130) + stripe;
      pixels[offset + 2] = 40 + ((seed >>> 16) % 130) + stripe;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
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
      : external
        ? localized[locale].external
        : `${localized[locale].manual} ${id}`;
  return PublicVehicleSchema.parse({
    ...base,
    id,
    stockCode: demo ? 'SHOW-ALPHA' : id === 'fixture_future' ? 'HD-FUTURE-01' : `HD-${id}`,
    source: external
      ? {
          kind: 'external',
          platform: { id: 'fixture_market', name: 'Fixture Marketplace' },
          listingUrl: 'https://example.invalid/listings/fixture-external',
        }
      : { kind: demo ? 'demo' : 'manual' },
    facts,
    price: demo
      ? { kind: 'on_request', money: null, includes: [] }
      : external
        ? { kind: 'reference', money: base.price.money, includes: [] }
        : base.price,
    content: {
      title: publicText(title, locale, !demo && !external),
      description: publicText(`${title} — HTTP fixture only.`, locale, !demo && !external),
    },
    images: Array.from({ length: 4 }, (_, imageIndex) => {
      const mediaId = `media_${id}${imageIndex ? `_${imageIndex + 1}` : ''}`;
      return {
        id: mediaId,
        url: `/api/v1/media/${mediaId}`,
        alt: `${title} fixture photo ${imageIndex + 1}`,
        width: 640,
        height: 420,
        sortOrder: imageIndex,
        isCover: imageIndex === 0,
      };
    }),
    availability:
      demo || external
        ? 'unknown'
        : id === 'fixture_reserved'
          ? 'reserved'
          : id === 'fixture_sold'
            ? 'sold'
            : 'available',
    availabilityCheckedAt:
      demo || external || overrides.availability === 'unknown' ? null : timestamp,
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
  longTitles: false,
  richCatalog: false,
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
  if (state.richCatalog) {
    for (const [index, row] of rows.entries()) {
      if (row.source.kind !== 'manual' || row.id === 'fixture_reserved') continue;
      row.facts.mileageKm = index * 10000;
      row.facts.modelYear = 2020 + (index % 6);
      row.facts.trim = { id: `${row.facts.model.id}_trim`, name: 'Premium' };
      row.facts.generation = { id: `${row.facts.model.id}_gen`, name: 'II' };
      row.facts.drivetrain = index % 2 ? 'awd' : 'fwd';
      row.price = {
        kind: 'asking',
        money: { amount: String(5000 + index * 1000), currency: index % 3 === 0 ? 'CNY' : 'USD' },
        includes: [],
      };
    }
  }
  if (state.longTitles) {
    const row = rows.find((item) => item.id === 'fixture_car_1');
    if (row) {
      row.content.title.text =
        locale === 'zh'
          ? '理想 L9 旗舰版 四驱 增程式豪华六座智能运动型多用途汽车 高配长标题车辆资料'
          : locale === 'ru'
            ? 'Автомобиль представительского класса с полным приводом и расширенным пакетом оборудования для международной поставки'
            : 'Luxury all-wheel-drive flagship extended-range vehicle with a very long fully specified equipment and trim title';
      row.stockCode = 'HD-LONG-REFERENCE-20261108-VEHICLE-EXPORT';
      row.price = {
        kind: 'reference',
        money: { amount: '999999999.99', currency: 'USD' },
        includes: [],
      };
    }
  }
  return rows;
}
function localizedProjection(row, locale) {
  const ready = (text) =>
    text
      ? {
          status: 'ready',
          text,
          requestedLocale: locale,
          contentLocale: locale,
          provenance: 'original',
          reviewed: row.source.kind === 'manual',
        }
      : {
          status: 'missing',
          text: null,
          requestedLocale: locale,
          contentLocale: null,
          provenance: null,
          reviewed: false,
        };
  const f = row.facts;
  return {
    ...row,
    facts: { ...f, generation: f.generation ?? null, drivetrain: f.drivetrain ?? null },
    display: {
      make: ready(f.make?.name),
      model: ready(f.model?.name),
      trim: ready(f.trim?.name),
      generation: ready(f.generation?.name),
      city: ready(f.location?.city),
      location: ready(f.location?.displayName),
      platform: ready(row.source.kind === 'external' ? row.source.platform.name : null),
      priceIncludes: row.price.includes.map((text, i) => ({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        value: ready(text),
      })),
      mediaAlt: row.images.map((image) => ({ mediaId: image.id, value: ready(image.alt) })),
    },
  };
}
function queryMatches(row, q) {
  const f = row.facts;
  if (!searchMatches(row, q.q)) return false;
  for (const key of ['make', 'model', 'trim', 'generation'])
    if (q[key] && f[key]?.id !== q[key]) return false;
  if (q.powertrain && f.powertrain !== q.powertrain) return false;
  if (q.drivetrain && f.drivetrain !== q.drivetrain) return false;
  for (const [key, field] of [
    ['mileage', 'mileageKm'],
    ['year', 'modelYear'],
  ]) {
    if (
      q[`${key}Min`] !== undefined &&
      (f[field] === null || f[field] === undefined || f[field] < q[`${key}Min`])
    )
      return false;
    if (
      q[`${key}Max`] !== undefined &&
      (f[field] === null || f[field] === undefined || f[field] > q[`${key}Max`])
    )
      return false;
  }
  const cents = (text) => {
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  };
  if (q.priceMin !== undefined || q.priceMax !== undefined) {
    if (!row.price.money || row.price.money.currency !== q.priceCurrency) return false;
    const amount = cents(row.price.money.amount);
    if (q.priceMin !== undefined && amount < cents(q.priceMin)) return false;
    if (q.priceMax !== undefined && amount > cents(q.priceMax)) return false;
  }
  return true;
}
function filterInput(raw) {
  const result = { ...raw };
  for (const key of ['page', 'pageSize', 'mileageMin', 'mileageMax', 'yearMin', 'yearMax'])
    if (result[key] !== undefined)
      result[key] = /^(0|[1-9]\d*)$/.test(result[key]) ? Number(result[key]) : NaN;
  return result;
}
// Mirrors public SQL strpos: the whole query is literal, fields are OR; selectors AND it.
function searchMatches(row, q) {
  const needle = q?.trim().toLocaleLowerCase();
  return (
    !needle ||
    [row.content.title.text, row.stockCode, row.facts.make?.name, row.facts.model?.name].some(
      (text) => text?.toLocaleLowerCase().includes(needle),
    )
  );
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
          longTitles: (v) => typeof v === 'boolean',
          richCatalog: (v) => typeof v === 'boolean',
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
          if (url.pathname.startsWith('/api/v1/media/'))
            mediaQuery = PublicMediaQuerySchema.parse(raw);
          else if (url.pathname === '/api/v1/vehicles') {
            catalogQuery = PublicVehicleQuerySchema.parse(filterInput(raw));
            locale = catalogQuery.locale;
          } else if (url.pathname === '/api/v1/vehicle-filters') {
            filterQuery = PublicFilterQuerySchema.parse(filterInput(raw));
            locale = filterQuery.locale;
          } else locale = PublicLocaleQuerySchema.parse(raw).locale;
        } catch {
          return send(res, 400, error('INVALID_REQUEST'));
        }
        if (state.responseDelayMs && !url.pathname.startsWith('/api/v1/media/'))
          await new Promise((resolve) => setTimeout(resolve, state.responseDelayMs));
      }
      // A fixed short Retry-After exercises browser cooldown without changing the real API limiter.
      // Media and facets stay readable; validation above still rejects malformed requests as 400.
      if (
        state.publicRateLimited &&
        (url.pathname === '/api/v1/home/vehicles' ||
          url.pathname === '/api/v1/vehicles' ||
          /^\/api\/v1\/vehicles\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(url.pathname))
      )
        return send(res, 429, error('RATE_LIMITED', true), { 'retry-after': '2' });
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
      const project = (row) =>
        url.searchParams.get('view') === 'localized' ? localizedProjection(row, locale) : row;
      const all = visibleVehicles(state, locale).map(project);
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
        const { page, pageSize } = catalogQuery;
        const filtered = all.filter((v) => queryMatches(v, catalogQuery));
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
        const searched = all.filter((v) => queryMatches(v, filterQuery));
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
                .map((id) => ({
                  id,
                  count: searched.filter((v) => v.facts.powertrain === id).length,
                }))
                .filter((v) => v.count),
              ...(url.searchParams.get('view') === 'localized'
                ? {
                    trims: [
                      ...new Map(
                        searched
                          .filter((v) => v.facts.trim)
                          .map((v) => [
                            v.facts.trim.id,
                            {
                              ...v.facts.trim,
                              makeId: v.facts.make.id,
                              modelId: v.facts.model.id,
                              count: searched.filter((x) => x.facts.trim?.id === v.facts.trim.id)
                                .length,
                            },
                          ]),
                      ).values(),
                    ],
                    generations: [
                      ...new Map(
                        searched
                          .filter((v) => v.facts.generation)
                          .map((v) => [
                            v.facts.generation.id,
                            {
                              ...v.facts.generation,
                              makeId: v.facts.make.id,
                              modelId: v.facts.model.id,
                              count: searched.filter(
                                (x) => x.facts.generation?.id === v.facts.generation.id,
                              ).length,
                            },
                          ]),
                      ).values(),
                    ],
                    drivetrains: [
                      ...new Set(searched.map((v) => v.facts.drivetrain).filter(Boolean)),
                    ].map((id) => ({
                      id,
                      count: searched.filter((v) => v.facts.drivetrain === id).length,
                    })),
                    modelYears: [
                      ...new Set(searched.map((v) => v.facts.modelYear).filter((x) => x !== null)),
                    ].map((year) => ({
                      year,
                      count: searched.filter((v) => v.facts.modelYear === year).length,
                    })),
                    priceCurrencies: [
                      ...new Set(searched.map((v) => v.price.money?.currency).filter(Boolean)),
                    ].map((id) => ({
                      id,
                      count: searched.filter((v) => v.price.money?.currency === id).length,
                    })),
                  }
                : {}),
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
                data: project(found),
                meta: { requestId: 'fixture-detail' },
              }),
            )
          : send(res, 404, error('NOT_FOUND'));
      }
      const mediaId = url.pathname.match(/^\/api\/v1\/media\/([A-Za-z0-9_-]+)$/)?.[1];
      if (mediaId) {
        const readable = [
          ...all,
          vehicle('fixture_sold', locale),
          ...(state.futurePublished && !state.futureArchived
            ? [vehicle('fixture_future', locale)]
            : []),
        ];
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
