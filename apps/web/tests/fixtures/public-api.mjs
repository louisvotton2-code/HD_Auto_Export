/** Isolated HTTP fixtures for the website. Never points at a database or operating inventory. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { makeImportedPublicVehicleFixture, makePublicVehicleFixture, makePublicationPreviewFixture, makeConfigurationDisplayFixture, makeExternalInspectionFixture } from '@hd/contracts/fixtures';
import { PublicationPreviewQuerySchema, PublicationPreviewResponseSchema } from '@hd/contracts/admin';
import {
  ApiErrorSchema,
  ExternalMediaFailureRequestSchema,
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
const importStates = ['supplier', 'original', 'conflict', 'missing', 'machine'];
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
  externalRemotePhoto: false,
  importedPublished: false,
  importedWithdrawn: false,
  importedPhotosRemoved: false,
  catalogSampleCount: null,
  historyScenario: 'default',
  configurationMode: 'none',
  inspectionMode: 'legacy',
  reportPresenceMode: 'default',
  responseDelayMs: 0,
  publicRateLimited: false,
  filtersRateLimited: false,
  longTitles: false,
  richCatalog: false,
  usdRateAvailable: true,
  previewMode: 'ready',
  previewPrice: 'normal',
  previewVersion: 4,
  previewDelayMs: 0,
  previewSlowLocale: '',
  previewImageCount: 1,
});

// Deliberately synthetic employee sessions, draft content and image bytes. These endpoints
// belong only to the isolated fixture server and never authenticate a real account.
const previewVehicleIds = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
];
const previewMediaIds = Array.from({ length: 12 }, (_, index) =>
  `00000000-0000-4000-8000-${(index === 0 ? 2 : index + 3).toString(16).padStart(12, '0')}`);
const previewModes = [
  'ready', 'incomplete', 'stale', 'machine', 'unauthenticated', 'forbidden', 'not_found',
  'conflict', 'unavailable', 'malformed', 'wrong_id', 'wrong_locale', 'private_field',
];
const previewStaff = (req) => /(?:^|;\s*)hd-preview-staff=authorized(?:;|$)/.test(req.headers.cookie ?? '');

function fixtureConfiguration(locale, mode) {
  if (mode === 'none') return null;
  const configuration = makeConfigurationDisplayFixture(locale);
  if (mode === 'missing') configuration.items[1].value = {
    status: 'missing', text: null, requestedLocale: locale, contentLocale: null, provenance: null, reviewed: false,
  };
  if (mode === 'fallback') {
    configuration.items[0].name = { ...configuration.items[0].name, text: '排量(cc)', contentLocale: 'zh', provenance: 'original' };
    configuration.items[0].value.text = '1989 cm³ / 8 AT';
  }
  if (mode === 'long') {
    configuration.items[0].name.text = 'Длинная характеристика '.repeat(4).slice(0, 100);
    configuration.items[0].value.text = '1234567890'.repeat(50);
  }
  if (mode === 'wrong_name_locale') configuration.items[0].name.requestedLocale = locale === 'ru' ? 'en' : 'ru';
  if (mode === 'wrong_value_locale') configuration.items[0].value.requestedLocale = locale === 'ru' ? 'en' : 'ru';
  return configuration;
}

function withReportPresence(row, mode) {
  if (mode === 'known') row.report = { hasReport: true };
  else if (mode === 'false') row.report = { hasReport: false };
  else if (mode === 'absent') delete row.report;
  return row;
}

function previewResponse(state, id, requestedLocale) {
  const locale = state.previewMode === 'wrong_locale' ? (requestedLocale === 'ru' ? 'en' : 'ru') : requestedLocale;
  const scenario = ['incomplete', 'stale', 'machine'].includes(state.previewMode) ? state.previewMode : 'ready';
  const preview = makePublicationPreviewFixture(locale, scenario);
  withReportPresence(preview.vehicle, state.reportPresenceMode);
  if (state.configurationMode !== 'none') preview.vehicle.configuration = fixtureConfiguration(locale, state.configurationMode);
  preview.vehicle.id = state.previewMode === 'wrong_id' ? previewVehicleIds[1] : id;
  preview.vehicle.stockCode = id === previewVehicleIds[0] ? 'FIXTURE-0001' : 'FIXTURE-0002';
  preview.vehicleVersion = state.previewVersion;
  preview.publicContentRevision = state.previewVersion - 1;
  preview.fingerprint = state.previewVersion.toString(16).padStart(64, '0');
  // Synthetic private gallery only; ordinary public fixtures and the real API are unchanged.
  if (preview.vehicle.images.length && state.previewImageCount > 1) {
    const cover = preview.vehicle.images[0];
    preview.vehicle.images = previewMediaIds.slice(0, state.previewImageCount).map((mediaId, index) => ({
      ...cover, id: mediaId, url: `/api/v1/admin/media/${mediaId}/preview`,
      sortOrder: index, isCover: index === 0,
    }));
  }
  if (state.previewPrice === 'on_request') {
    preview.vehicle.price = { kind: 'on_request', money: null, includes: [], status: 'on_request',
      displayPrice: { status: 'on_request', money: null, conversion: null } };
  } else if (state.previewPrice === 'zero') {
    preview.vehicle.price = { kind: 'asking', money: { amount: '0', currency: 'USD' }, includes: [], status: 'ready',
      displayPrice: { status: 'ready', kind: 'asking', money: { amount: '0', currency: 'USD' }, conversion: null } };
  } else if (state.previewPrice === 'unavailable') {
    preview.vehicle.price = { kind: 'asking', money: { amount: '128000.50', currency: 'CNY' }, includes: [], status: 'ready',
      displayPrice: { status: 'unavailable', money: null, conversion: null, reason: 'rate_unavailable' } };
  }
  const response = PublicationPreviewResponseSchema.parse({ data: preview, meta: { requestId: 'fixture-publication-preview' } });
  if (state.previewMode === 'private_field') response.data.vehicle.internal = { purchaseCost: 'PRIVATE_COST_SENTINEL', notes: 'PRIVATE_NOTES_SENTINEL' };
  return response;
}
function visibleVehicles(state, locale) {
  if (state.mode === 'empty') return [];
  // Extra unique records exist only inside this health-marked fixture, never operating inventory.
  const rows = state.catalogSampleCount !== null
    ? Array.from({ length: state.catalogSampleCount }, (_, index) => vehicle(`fixture_car_${index + 1}`, locale))
    : [
    vehicle('fixture_demo', locale),
    ...Array.from({ length: 24 }, (_, i) => vehicle(`fixture_car_${i + 1}`, locale)),
    vehicle('fixture_reserved', locale),
  ];
  if (state.futurePublished && !state.futureArchived && state.futureAvailability !== 'sold')
    rows.unshift(vehicle('fixture_future', locale, { availability: state.futureAvailability }));
  if (state.externalPublished) {
    const external = vehicle('fixture_external', locale);
    if (state.externalRemotePhoto)
      external.images[0].url = 'https://photos.example.invalid/fixture-external.jpg';
    rows.push(external);
  }
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
function cents(text) {
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function fixtureUsdPrice(row, rateAvailable) {
  const { kind, money } = row.price;
  if (!money) return { status: 'on_request', money: null, conversion: null };
  const native = money.currency === 'USD';
  if (!native && (!rateAvailable || money.currency !== 'CNY'))
    return { status: 'unavailable', money: null, conversion: null, reason: 'rate_unavailable' };
  // The isolated sample rate is exactly 8 CNY per USD, with half-up cent rounding.
  const value = native ? cents(money.amount) : (cents(money.amount) + 4n) / 8n;
  return {
    status: 'ready',
    kind: native ? kind : 'reference',
    money: { amount: `${value / 100n}.${String(value % 100n).padStart(2, '0')}`, currency: 'USD' },
    conversion: native ? null : { asOf: timestamp, source: 'exchange_rate_api' },
  };
}
function queryMoney(row, q) {
  return q.priceView === 'usd' ? row.displayPrice?.money : row.price.money;
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
  if (q.priceMin !== undefined || q.priceMax !== undefined) {
    const money = queryMoney(row, q);
    if (!money || money.currency !== q.priceCurrency) return false;
    const amount = cents(money.amount);
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
          externalRemotePhoto: (v) => typeof v === 'boolean',
          importedPublished: (v) => typeof v === 'boolean',
          importedWithdrawn: (v) => typeof v === 'boolean',
          importedPhotosRemoved: (v) => typeof v === 'boolean',
          catalogSampleCount: (v) => v === null || Number.isInteger(v) && v >= 0 && v <= 120,
          historyScenario: (v) => ['default', 'complete', 'empty', 'conflict', 'structured-zero', 'structured-null', 'structured-two'].includes(v),
          configurationMode: (v) => ['none', 'ready', 'missing', 'fallback', 'long', 'wrong_name_locale', 'wrong_value_locale'].includes(v),
          inspectionMode: (v) => ['legacy', 'structured', 'large', 'legacy-large', 'empty'].includes(v),
          reportPresenceMode: (v) => ['default', 'known', 'false', 'absent'].includes(v),
          responseDelayMs: (v) => Number.isInteger(v) && v >= 0 && v <= 5000,
          publicRateLimited: (v) => typeof v === 'boolean',
          filtersRateLimited: (v) => typeof v === 'boolean',
          longTitles: (v) => typeof v === 'boolean',
          richCatalog: (v) => typeof v === 'boolean',
          usdRateAvailable: (v) => typeof v === 'boolean',
          previewMode: (v) => previewModes.includes(v),
          previewPrice: (v) => ['normal', 'on_request', 'zero', 'unavailable'].includes(v),
          previewVersion: (v) => Number.isInteger(v) && v >= 2 && v <= 100,
          previewDelayMs: (v) => Number.isInteger(v) && v >= 0 && v <= 5000,
          previewSlowLocale: (v) => ['', 'zh', 'en', 'ru'].includes(v),
          previewImageCount: (v) => Number.isInteger(v) && v >= 1 && v <= previewMediaIds.length,
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
          method: req.method,
          query: Object.fromEntries(url.searchParams),
          cookie: req.headers.cookie ?? null,
          authorization: req.headers.authorization ?? null,
        });
        if (requests.length > 1000) requests.shift();
      }
      const previewMatch = /^\/api\/v1\/admin\/vehicles\/([A-Za-z0-9_-]+)\/publication-preview\/?$/.exec(url.pathname);
      const previewMedia = /^\/api\/v1\/admin\/media\/([A-Za-z0-9_-]+)\/preview\/?$/.exec(url.pathname);
      if (previewMatch || previewMedia) {
        if (req.method !== 'GET') return send(res, 405, error('INVALID_REQUEST'));
        if (!previewStaff(req) || state.previewMode === 'unauthenticated')
          return send(res, 401, error('UNAUTHENTICATED'));
        if (state.previewMode === 'forbidden') return send(res, 403, error('FORBIDDEN'));
        if (previewMedia) {
          if (!previewMediaIds.includes(previewMedia[1])) return send(res, 404, error('NOT_FOUND'));
          const png = imageBytes(previewMedia[1], false);
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'no-store' });
          return res.end(png);
        }
        const requested = PublicationPreviewQuerySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!requested.success) return send(res, 400, error('INVALID_REQUEST'));
        const snapshot = { ...state };
        const locale = requested.data.locale;
        if (snapshot.previewDelayMs && (!snapshot.previewSlowLocale || snapshot.previewSlowLocale === locale))
          await new Promise((resolve) => setTimeout(resolve, snapshot.previewDelayMs));
        if (!previewVehicleIds.includes(previewMatch[1]) || snapshot.previewMode === 'not_found') return send(res, 404, error('NOT_FOUND'));
        if (snapshot.previewMode === 'conflict') return send(res, 409, error('VERSION_CONFLICT'));
        if (snapshot.previewMode === 'unavailable') {
          const failure = error('SERVICE_UNAVAILABLE', true);
          failure.error.message = 'PRIVATE_UPSTREAM_ERROR_SENTINEL';
          return send(res, 503, failure);
        }
        if (snapshot.previewMode === 'malformed') return send(res, 200, { data: { internal: 'PRIVATE_PAYLOAD_SENTINEL' } });
        return send(res, 200, previewResponse(snapshot, previewMatch[1], locale));
      }
      const mediaFailure = /^\/api\/v1\/external-media\/(ximg-[a-f0-9-]+)\/failure$/.exec(url.pathname);
      if (mediaFailure && req.method === 'POST') {
        const report = ExternalMediaFailureRequestSchema.safeParse(await body(req));
        if (!report.success) return send(res, 400, error('INVALID_REQUEST'));
        const active = state.importedPublished && !state.importedWithdrawn &&
          mediaFailure[1] === makeImportedPublicVehicleFixture('en').images[0].id;
        return send(res, 202, {data:{queued:active && report.data.revision===1},meta:{requestId:'fixture-media-report'}});
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
      const priceProjection = (row) =>
        url.searchParams.get('priceView') === 'usd'
          ? { ...row, displayPrice: fixtureUsdPrice(row, state.usdRateAvailable) }
          : row;
      const project = (row) => priceProjection(
        url.searchParams.get('view') === 'localized' ? localizedProjection(row, locale) : row,
      );
      const staff = visibleVehicles(state, locale).map(project);
      const imports = state.importedPublished && state.mode !== 'empty' && url.searchParams.get('view') === 'localized'
        ? importStates.filter((kind) => kind !== 'supplier' || !state.importedWithdrawn)
        : [];
      const makeImport = (kind, detail = false) => {
        const item = makeImportedPublicVehicleFixture(locale, kind, detail);
        if (detail && kind === 'supplier' && state.historyScenario !== 'default') {
          // Deliberately synthetic history records exercise public rendering only. The default
          // supplier projection and its unverified report URL keep their previous behavior.
          const entry = (name, value) => ({ name: { text: name, contentLocale: 'en' }, value: { text: value, contentLocale: 'en' } });
          const specs = item.external.detail.specifications;
          const inspection = item.external.detail.inspection;
          if (state.historyScenario === 'complete') {
            specs.push(entry('accidentCount', '0'), entry('Ownership transfers', '2'), entry('ownerCount', '3'), entry('plateChangeCount', '0'));
            inspection.entries.push(entry('theft', 'false'), entry('floodCount', '0'), entry('waterDamage', 'false'), entry('fire damage', 'false'), entry('total loss', 'false'),
              entry('Accident items', '9 / 24'), entry('Flood items', '0 / 18'));
          } else if (state.historyScenario === 'empty') {
            specs.push(entry('Ownership transfers', 'unknown'), entry('accidentCount', '—'));
            inspection.entries.push(entry('theft history', 'not provided'), entry('Accident items', '0 / 24'), entry('Flood items', '0 / 18'));
          } else if (state.historyScenario === 'conflict') {
            specs.push(entry('Ownership transfers', '0'), entry('accidentCount', '0'));
            inspection.entries.push(entry('owner changes', '2'), entry('number of accidents', '1'), entry('waterDamage', 'unknown'));
          } else {
            item.external.detail.history = { ownershipTransfers: state.historyScenario === 'structured-null' ? null : state.historyScenario === 'structured-zero' ? 0 : 2 };
            // A structured null/zero takes precedence over an obsolete generic entry.
            specs.push(entry('Ownership transfers', '9'));
          }
        }
        if (detail && kind === 'supplier' && state.inspectionMode !== 'legacy') {
          item.external.detail.inspection = state.inspectionMode === 'structured' || state.inspectionMode === 'large'
            ? makeExternalInspectionFixture('unknown')
            : { entries: [], checks: [], defects: [], reportUrl: null };
          if (state.inspectionMode === 'large' || state.inspectionMode === 'legacy-large') {
            const inspection = item.external.detail.inspection;
            const sample = makeExternalInspectionFixture('unknown').checks[0];
            inspection.checks = state.inspectionMode === 'legacy-large' ? [] : Array.from({ length: 8 }, (_, index) => ({
              ...sample, category: { text: `Inspection category ${index + 1}`, contentLocale: 'en' },
              groups: [{ ...sample.groups[0], items: Array.from({ length: 24 }, (_, leaf) => ({
                part: { text: `Inspection part ${leaf + 1}`, contentLocale: 'en' }, result: null, ok: null,
              })) }],
            }));
            inspection.entries = Array.from({ length: 8 }, (_, index) => ({ name: { text: `Inspection summary ${index + 1}`, contentLocale: 'en' }, value: { text: 'Not provided', contentLocale: 'en' } }));
          }
        }
        if (detail) withReportPresence(item, state.reportPresenceMode);
        if (detail && state.configurationMode !== 'none') item.configuration = fixtureConfiguration(locale, state.configurationMode);
        if (state.importedPhotosRemoved && kind === 'supplier') {
          item.images = [];
          item.display.mediaAlt = [];
          item.external.issues.push({ field: 'images', code: 'expired' });
        }
        return priceProjection(item);
      };
      const all = [...staff, ...imports.map((kind) => makeImport(kind))];
      if (url.pathname === '/api/v1/home/vehicles') {
        const sections =
          state.sectionCount > 0 && staff.length
            ? [
                {
                  id: 'featured',
                  title: localized[locale].first,
                  vehicles: staff
                    .filter((v) => v.source.kind === 'demo' || v.availability === 'available')
                    .slice(0, 3),
                },
              ]
            : [];
        if (state.sectionCount === 2 && staff.length)
          sections.push({
            id: 'recent',
            title: localized[locale].second,
            vehicles: staff
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
        const makes = new Map(), models = new Map(), powertrains = new Map();
        for (const row of searched) {
          const { make, model, powertrain } = row.facts;
          if (make) makes.set(make.id, {...make,count:(makes.get(make.id)?.count ?? 0)+1});
          if (make && model) {
            const key = `${make.id}:${model.id}`;
            models.set(key, {...model,makeId:make.id,count:(models.get(key)?.count ?? 0)+1});
          }
          if (!row.external || powertrain !== 'unknown')
            powertrains.set(powertrain,(powertrains.get(powertrain) ?? 0)+1);
        }
        return send(
          res,
          200,
          PublicVehicleFiltersSchema.parse({
            data: {
              catalog: 'curated',
              ...(state.importedPublished && filterQuery.view === 'localized' ? { total: searched.length } : {}),
              makes: [...makes.values()].sort((a,b)=>a.id.localeCompare(b.id)),
              models: [...models.values()].sort((a,b)=>a.makeId.localeCompare(b.makeId)||a.id.localeCompare(b.id)),
              powertrains: [...powertrains].sort(([a],[b])=>a.localeCompare(b)).map(([id,count])=>({id,count})),
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
                      ...new Set(searched.map((v) => queryMoney(v, filterQuery)?.currency).filter(Boolean)),
                    ].map((id) => ({
                      id,
                      count: searched.filter((v) => queryMoney(v, filterQuery)?.currency === id).length,
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
        const kind = imports.find((kind) => makeImportedPublicVehicleFixture(locale,kind).id === detailId);
        if (kind) return send(res,200,PublicVehicleResponseSchema.parse({data:makeImport(kind,true),meta:{requestId:'fixture-import-detail'}}));
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
                data: withReportPresence({ ...project(found), ...(state.configurationMode !== 'none' ? { configuration: fixtureConfiguration(locale, state.configurationMode) } : {}) }, state.reportPresenceMode),
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
