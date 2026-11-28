import type { PoolClient } from 'pg';
import { z } from 'zod';
import { findBrand, type LocalizationData, type VehicleConfiguration } from '@hd/contracts/admin';
import {
  DrivetrainSchema, externalInquiryNumber, NamedValueSchema, PublicCatalogCursorSchema, PublicConfigurationEntrySchema,
  PublicPriceSchema, PublicTextSchema, SalesVehicleSchema,
  type Locale, type SalesVehicle, type SalesVehicleListResponse, type SalesVehicleLookupQuery,
  type SalesVehicleLookupResponse, type SalesVehicleQuery,
} from '@hd/contracts/public';
import { isCursorTime } from '../cursor-time.js';
import type { Database } from '../db/index.js';
import { ApiError, notFound } from '../errors.js';
import { type FxQuote, readFxQuote } from '../external/fx.js';
import { displayText, fallbackExternalTitle, isPublicText, safeExternalDisplayText } from '../external/normalize.js';
import { readSourceSegment } from '../external/sources/index.js';
import { projectConfiguration } from '../vehicles/configuration.js';
import { digest, resolveDisplay } from '../vehicles/localization.js';
import { projectUsdPrice, staffPriceAmountSql, staffUsdCondition, usdSourceRange } from '../vehicles/usd-price.js';

const Source = z.enum(['staff', 'supplier']);
type Source = z.infer<typeof Source>;
const FeedCursor = z.strictObject({
  version: z.literal(1), binding: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.string().refine(isCursorTime), id: z.uuid(), source: Source,
});
type FeedCursor = z.infer<typeof FeedCursor>;
const ConfigCursor = z.strictObject({
  version: z.literal(1), binding: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().nonnegative().max(2_147_483_647),
});
type ConfigItem = SalesVehicleLookupResponse['data']['configuration']['items'][number];
type Name = NonNullable<SalesVehicle['facts']['make']>;
type PublicRow = {
  id: string; stock_number: string; source: Source; source_kind: SalesVehicle['sourceKind'];
  title: unknown; source_language: string | null; names: Record<string, string | null>;
  facts: SalesVehicle['facts']; price: unknown; availability: SalesVehicle['availability'];
  source_updated_at: string | Date | null; published_at: Date; sort_at: string; publication_id: string | null;
};
type Target = { source: Source; column: 'id' | 'stock_number'; value: string };
const readSnapshot = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const settings = "SET LOCAL statement_timeout='3s'; SET LOCAL jit=off; SET LOCAL max_parallel_workers_per_gather=0";
const localeMasks = { zh: [1, 3, 5, 7], en: [2, 3, 6, 7], ru: [4, 5, 6, 7] };
const trimCharacters = "U&'\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'";
const staffTitle = "p.data#>'{content,title,translations}'->$1::text";
const staffFacts = "p.data->'facts'";
const staffDrivetrain = `CASE WHEN pl.publication_id IS NULL
  THEN ${staffFacts}->>'drivetrain' ELSE pl.data#>>'{facts,drivetrain}' END`;
const sourceKind = "p.data#>>'{source,kind}'";
const staffAvailable = `${sourceKind}='manual' AND v.availability='available'`;
const staffVisible = `v.deleted_at IS NULL AND v.publication_state='published' AND v.published_at IS NOT NULL
  AND ${sourceKind} IN ('manual','external') AND nullif(btrim(${staffTitle}->>'text',${trimCharacters}),'') IS NOT NULL`;
// The formal identity still takes precedence when its current listing is hidden, withdrawn, or no longer primary.
const supplierVisible = `f.active AND f.locale_mask<>0 AND f.locale_mask=ANY($2::smallint[])
  AND l.upstream_state='active' AND l.formal_primary AND (o.data->'hidden') IS DISTINCT FROM 'true'::jsonb
  AND (l.provider<>'chinacarapi-sample' OR NOT EXISTS (SELECT 1 FROM external_listings incumbent
    WHERE incumbent.provider='chinacarapi' AND incumbent.platform_id=l.platform_id AND incumbent.external_id=l.external_id))`;
const supplierAvailable = `l.provider IN ('chinacarapi','chinacarapi-sample') AND l.platform_id IN ('che168','dongchedi')
  AND l.external_id ~ '^[0-9]{1,100}$'`;
const timeKey = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const names = ['make', 'model', 'trim'] as const;

function parameter(params: unknown[], value: unknown) {
  return `$${params.push(value)}`;
}

function searchConditions(query: SalesVehicleQuery, source: Source, params: unknown[], quote: FxQuote | null) {
  const staff = source === 'staff';
  const conditions: string[] = [];
  const add = (column: string, operator: string, value: string | number | undefined) => {
    if (value !== undefined) conditions.push(`${column}${operator}${parameter(params, value)}`);
  };
  for (const key of names) {
    add(staff ? `(${staffFacts}->'${key}'->>'id')` : `f.${key}_id`, '=', query[key]);
  }
  add(staff ? `(${staffFacts}->>'powertrain')` : 'f.powertrain', '=', query.powertrain);
  if (query.drivetrain) {
    const drives = query.drivetrain === 'four_wheel' ? ['awd', 'four_wd'] : [query.drivetrain];
    conditions.push(`(${staff ? staffDrivetrain : 'f.drivetrain'})=ANY(${parameter(params, drives)}::text[])`);
  }
  const mileage = staff ? `(${staffFacts}->>'mileageKm')::integer` : 'f.mileage_km';
  const year = staff ? `(${staffFacts}->>'modelYear')::integer` : 'f.model_year';
  add(mileage, '>=', query.mileageMin);
  add(mileage, '<=', query.mileageMax);
  add(year, '>=', query.yearMin);
  add(year, '<=', query.yearMax);
  if (query.priceMin === undefined && query.priceMax === undefined) return conditions;

  if (staff) {
    conditions.push("p.data->'price'->>'kind' IN ('asking','reference')");
    if (query.priceCurrency === 'USD') conditions.push(staffUsdCondition(params, quote, query.priceMin, query.priceMax));
    else {
      conditions.push("p.data#>>'{price,money,currency}'='CNY'");
      add(`(${staffPriceAmountSql})`, '>=', query.priceMin);
      add(`(${staffPriceAmountSql})`, '<=', query.priceMax);
    }
  } else if (query.priceCurrency === 'USD') {
    const range = usdSourceRange('CNY', quote, query.priceMin, query.priceMax);
    if (!range) conditions.push('false');
    else {
      add('f.price_cny', '>=', range.minimum);
      add('f.price_cny', '<=', range.maximum);
    }
  } else {
    add('f.price_cny', '>=', query.priceMin);
    add('f.price_cny', '<=', query.priceMax);
  }
  return conditions;
}

function afterKey(cursor: FeedCursor | undefined, source: Source, published: string, id: string, params: unknown[]) {
  if (!cursor) return 'true';
  const date = `${parameter(params, cursor.at)}::timestamptz`;
  const uuid = `${parameter(params, cursor.id)}::uuid`;
  const comparison = source > cursor.source ? '>=' : '>';
  return `(${published}<=${date} AND (${published}<${date} OR ${id}${comparison}${uuid}))`;
}

function staffDisplayName(key: string) {
  return `CASE WHEN pl.projections->>'policyVersion'='2' THEN pl.projections->$1::text->'facts'->'${key}'->>'name'
    ELSE (SELECT field->'translations'->$1::text->>'text'
      FROM jsonb_array_elements(pl.data->'fields') field WHERE field->>'ref'='${key}' LIMIT 1) END`;
}

function readStaff(tx: PoolClient, params: unknown[], predicates: string[], limit: number) {
  const rawIncludes = "coalesce(nullif(p.data#>'{price,includes}','null'::jsonb),'[]'::jsonb)";
  const localIncludes = "pl.projections->$1::text#>'{price,includes}'";
  // An incomplete localization would conceal package terms. The saved public
  // publication supplies the original terms in that case and for old rows.
  const includes = `CASE WHEN pl.projections->>'policyVersion'='2' AND jsonb_typeof(${localIncludes})='array'
    THEN CASE WHEN jsonb_array_length(${localIncludes})=jsonb_array_length(${rawIncludes})
      THEN ${localIncludes} ELSE ${rawIncludes} END ELSE ${rawIncludes} END`;
  return tx.query<PublicRow>(`SELECT v.id,v.stock_number::text,'staff' AS source,${sourceKind} AS source_kind,
    ${staffTitle} AS title,p.data#>>'{content,title,sourceLanguage}' AS source_language,
    jsonb_build_object(${names.map(key => `'${key}',${staffDisplayName(key)}`).join(',')}) AS names,
    jsonb_build_object('make',${staffFacts}->'make','model',${staffFacts}->'model','trim',${staffFacts}->'trim',
      'modelYear',${staffFacts}->'modelYear','mileageKm',${staffFacts}->'mileageKm','powertrain',${staffFacts}->'powertrain',
      'drivetrain',${staffDrivetrain}) AS facts,
    jsonb_build_object('kind',p.data#>>'{price,kind}','money',p.data#>'{price,money}','includes',${includes}) AS price,
    v.availability,CASE WHEN ${sourceKind}='external' THEN p.data#>>'{source,sourceUpdatedAt}' END AS source_updated_at,
    v.published_at,${timeKey('v.published_at')} AS sort_at,p.id AS publication_id
    FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id
    LEFT JOIN publication_localizations pl ON pl.publication_id=p.id
    WHERE ${staffVisible} AND ${predicates.join(' AND ')}
    ORDER BY v.published_at DESC,v.id LIMIT ${parameter(params, limit)}`, params);
}

function readSupplier(tx: PoolClient, params: unknown[], predicates: string[], limit: number) {
  const localized = "c.localized->$1::text";
  const displayName = (key: string) => `CASE WHEN x.data#>>'{names,${key},status}'='ready'
    AND (${localized}->'display'->'${key}'->>'provenance') IS DISTINCT FROM 'human'
    AND NOT coalesce((p.overridden_facts ? '${key}'),false) THEN x.data#>>'{names,${key},text}'
    ELSE ${localized}->'display'->'${key}'->>'text' END`;
  // Bound reads of the wider localized and vehicle-extras projections by the selected page.
  return tx.query<PublicRow>(`WITH picked AS MATERIALIZED (
    SELECT f.listing_id,f.published_at,f.model_year,f.mileage_km,f.powertrain,f.drivetrain,f.price_cny,
      l.inquiry_number,l.source_updated_at,o.data->'facts' AS overridden_facts
    FROM external_catalog_filter f JOIN external_listings l ON l.id=f.listing_id
    LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
    WHERE ${supplierVisible} AND ${predicates.join(' AND ')}
    ORDER BY f.published_at DESC,f.listing_id LIMIT ${parameter(params, limit)}
  ) SELECT p.listing_id AS id,p.inquiry_number::text AS stock_number,'supplier' AS source,'external' AS source_kind,
    ${localized}->'title' AS title,NULL AS source_language,
    jsonb_build_object(${names.map(key => `'${key}',${displayName(key)}`).join(',')}) AS names,
    jsonb_build_object('make',c.facts->'make','model',c.facts->'model','trim',c.facts->'trim',
      'modelYear',p.model_year,'mileageKm',p.mileage_km,'powertrain',coalesce(p.powertrain,'unknown'),'drivetrain',p.drivetrain) AS facts,
    CASE WHEN p.price_cny IS NULL THEN '{"kind":"on_request","money":null,"includes":[]}'::jsonb
      ELSE jsonb_build_object('kind','reference','money',jsonb_build_object('currency','CNY','amount',p.price_cny::text),'includes','[]'::jsonb)
      END AS price,
    'unknown' AS availability,p.source_updated_at,p.published_at,${timeKey('p.published_at')} AS sort_at,NULL AS publication_id
    FROM picked p JOIN external_catalog c ON c.listing_id=p.listing_id
    LEFT JOIN external_vehicle_extras x ON x.listing_id=p.listing_id AND x.locale=$1::text
    ORDER BY p.published_at DESC,p.listing_id`, params);
}

function safeName(fact: Name | null, localized: string | null, rawFallback: boolean) {
  const named = NamedValueSchema.safeParse(fact);
  if (!named.success) return null;
  if (localized && isPublicText(localized)) {
    const candidate = NamedValueSchema.safeParse({ id: named.data.id, name: localized });
    if (candidate.success) return candidate.data;
  }
  return rawFallback && isPublicText(named.data.name) ? named.data : null;
}

function toSalesVehicle(row: PublicRow, locale: Locale, quote: FxQuote | null) {
  const supplier = row.source === 'supplier';
  const id = supplier ? `ext-${row.id}` : row.id;
  const staffTitle = row.title as { text?: string; kind?: string; reviewStatus?: string } | null;
  const title = PublicTextSchema.safeParse(supplier ? row.title : {
    text: staffTitle?.text, kind: staffTitle?.kind, requestedLocale: locale,
    contentLocale: staffTitle?.kind === 'original' ? row.source_language : locale,
    reviewed: row.source_kind === 'manual' && staffTitle?.reviewStatus === 'approved',
  });
  const originalPrice = PublicPriceSchema.parse(row.price);
  const price = { ...originalPrice, includes: originalPrice.includes.filter(isPublicText) };
  // The values below are selected independently from the publication or supplier public projection.
  return SalesVehicleSchema.parse({
    id, stockCode: supplier ? `HX${row.stock_number}` : `HD-${row.stock_number.padStart(6, '0')}`,
    detailPath: `/${locale}/cars/${id}/`, title: title.success && isPublicText(title.data.text)
      ? title.data : fallbackExternalTitle(locale),
    sourceKind: row.source_kind,
    facts: {
      ...row.facts, drivetrain: DrivetrainSchema.safeParse(row.facts.drivetrain).data ?? null,
      make: safeName(row.facts.make, row.names.make ?? (supplier ? null : findBrand(row.facts.make)?.labels[locale] ?? null), supplier),
      model: safeName(row.facts.model, row.names.model ?? null, supplier),
      trim: safeName(row.facts.trim, row.names.trim ?? null, supplier),
    },
    price, displayPrice: projectUsdPrice(price, quote),
    availability: row.source_kind === 'external' ? 'unknown' : row.availability,
    sourceUpdatedAt: row.source_updated_at instanceof Date ? row.source_updated_at.toISOString() : row.source_updated_at,
    publishedAt: row.published_at.toISOString(),
  });
}

const invalid = (message: string) => new ApiError(400, 'INVALID_REQUEST', message);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function cursorValue<T extends z.ZodType>(shape: T, cursor: string | undefined) {
  if (cursor === undefined) return undefined;
  try {
    return shape.parse(JSON.parse(Buffer.from(PublicCatalogCursorSchema.parse(cursor), 'base64url').toString('utf-8')));
  } catch {
    throw invalid('Invalid sales page cursor.');
  }
}

function lookupTarget(query: SalesVehicleLookupQuery, siteOrigin: string): Target {
  if (query.stockCode !== undefined) {
    const external = externalInquiryNumber(query.stockCode);
    if (external) return { source: 'supplier', column: 'stock_number', value: external };
    const digits = /^HD-([0-9]{6,19})$/i.exec(query.stockCode)?.[1];
    if (digits && BigInt(digits) > 0n && BigInt(digits) <= 9223372036854775807n) {
      const number = BigInt(digits).toString();
      if (number.padStart(6, '0') === digits) return { source: 'staff', column: 'stock_number', value: number };
    }
    throw notFound();
  }
  let url;
  try { url = new URL(query.detailUrl ?? ''); }
  catch { throw invalid('Expected a trusted vehicle detail URL.'); }
  const match = /^\/(?:en|ru|zh)\/cars\/(ext-)?([\da-f-]{36})\/?$/i.exec(url.pathname);
  if (url.origin !== siteOrigin || url.username || url.password || url.href.includes('?') || url.href.includes('#') || !match || !z.uuid().safeParse(match[2]).success) {
    throw invalid('Expected a trusted vehicle detail URL.');
  }
  return { source: match[1] ? 'supplier' : 'staff', column: 'id', value: match[2]!.toLowerCase() };
}

function protectConfiguration(item: ConfigItem, locale: Locale) {
  const name = safeExternalDisplayText(locale, item.name);
  return PublicConfigurationEntrySchema.parse({ id: item.id, name,
    value: item.name.status === 'ready' && name.status === 'missing'
      ? displayText(locale, null) : safeExternalDisplayText(locale, item.value) });
}

type Tagged = Exclude<Parameters<typeof displayText>[1], null>;
async function configurationPage(tx: PoolClient, row: PublicRow, locale: Locale, offset: number, limit: number) {
  if (row.source === 'supplier') {
    const page = await readSourceSegment(tx, row.id, locale, 'configuration', offset, limit);
    if (page) return { ...page, items: page.items.map(item => protectConfiguration(item as ConfigItem, locale)) };
    const legacy = await tx.query<{ specifications: {name: Tagged | null; value: Tagged | null}[] | null }>(
      "SELECT details->'specifications' AS specifications FROM external_catalog WHERE listing_id=$1", [row.id]);
    const all = legacy.rows[0]?.specifications ?? [];
    return { total: all.length, revision: digest(all), items: all.slice(offset, offset + limit).map((entry, index) =>
      protectConfiguration({ id: `spec-${offset + index}-${digest(entry).slice(0, 20)}`,
        name: displayText(locale, entry.name), value: displayText(locale, entry.value) }, locale)) };
  }
  const { rows: [published] } = await tx.query<{ configuration: VehicleConfiguration | null; fields: LocalizationData['fields'] | null }>(
    "SELECT p.data->'configuration' AS configuration,pl.data->'fields' AS fields FROM vehicle_publications p LEFT JOIN publication_localizations pl ON pl.publication_id=p.id WHERE p.id=$1", [row.publication_id]);
  const fields = new Map(published?.fields?.map(field => [field.ref, field]));
  const all = projectConfiguration(published?.configuration, locale,
    ref => resolveDisplay(fields.get(ref), locale, row.source_kind === 'manual'))?.items ?? [];
  return { total: all.length, revision: digest(all), items: all.slice(offset, offset + limit).map(item => protectConfiguration(item, locale)) };
}

export class SalesVehicleService {
  constructor(private readonly db: Database, private readonly externalCatalog: boolean, private readonly siteOrigin: string) {}

  private async read<T>(work: (tx: PoolClient, asOf: string) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async tx => {
        await tx.query(readSnapshot);
        await tx.query(settings);
        const result = await tx.query<{as_of: Date}>('SELECT now() AS as_of');
        return work(tx, result.rows[0]!.as_of.toISOString());
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '57014') {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Sales data is temporarily unavailable.', undefined, true);
      }
      throw error;
    }
  }

  async feed(query: SalesVehicleQuery): Promise<SalesVehicleListResponse['data']> {
    const cursor = cursorValue(FeedCursor, query.cursor);
    return this.read(async (tx, asOf) => {
      const quote = await readFxQuote(tx);
      const binding = digest([query.locale,query.make,query.model,query.trim,query.yearMin,query.yearMax,query.mileageMin,
        query.mileageMax,query.powertrain,query.drivetrain,query.priceMin,query.priceMax,query.priceCurrency,query.limit,
        this.externalCatalog,query.priceCurrency === 'USD' ? quote?.version : null]);
      if (cursor && cursor.binding !== binding) throw invalid('Sales page cursor does not match this query.');
      const staffParams: unknown[] = [query.locale];
      const staff = await readStaff(tx, staffParams, [staffAvailable,
        ...searchConditions(query, 'staff', staffParams, quote),
        afterKey(cursor, 'staff', 'v.published_at', 'v.id', staffParams)], query.limit + 1);
      const supplierParams: unknown[] = [query.locale, localeMasks[query.locale]];
      const supplier = this.externalCatalog ? await readSupplier(tx, supplierParams, [supplierAvailable,
        ...searchConditions(query, 'supplier', supplierParams, quote),
        afterKey(cursor, 'supplier', 'f.published_at', 'f.listing_id', supplierParams)], query.limit + 1) : null;
      const rows = staff.rows.concat(supplier?.rows ?? []).sort((a, b) =>
        a.sort_at < b.sort_at ? 1 : a.sort_at > b.sort_at ? -1 : a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return { items: page.map(row => toSalesVehicle(row, query.locale, quote)), asOf,
        nextCursor: last && rows.length > query.limit
          ? encode({ version: 1, binding, at: last.sort_at, id: last.id, source: last.source }) : null };
    });
  }

  async lookup(query: SalesVehicleLookupQuery): Promise<SalesVehicleLookupResponse['data']> {
    const target = lookupTarget(query, this.siteOrigin);
    const cursor = cursorValue(ConfigCursor, query.configurationCursor);
    const binding = digest([target.source,query.locale]);
    if (target.source === 'supplier' && !this.externalCatalog) throw notFound();
    return this.read(async (tx, asOf) => {
      const params: unknown[] = target.source === 'staff' ? [query.locale] : [query.locale, localeMasks[query.locale]];
      const idColumn = target.source === 'staff' ? 'v.id' : 'l.id';
      const stockColumn = target.source === 'staff' ? 'v.stock_number' : 'l.inquiry_number';
      const predicate = `${target.column === 'id' ? idColumn : stockColumn}=${parameter(params, target.value)}`;
      const { rows: [row] } = await (target.source === 'staff'
        ? readStaff(tx, params, [predicate], 1) : readSupplier(tx, params, [predicate], 1));
      if (!row) throw notFound();
      const vehicleBinding = digest([binding,row.id]);
      if (cursor && cursor.binding !== vehicleBinding) throw invalid('Configuration cursor does not match this vehicle.');
      const offset = cursor?.offset ?? 0;
      const configuration = await configurationPage(tx, row, query.locale, offset, query.configurationLimit);
      if (cursor && cursor.revision !== configuration.revision) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'Reload the current configuration before continuing.');
      }
      const next = offset + configuration.items.length;
      return { vehicle: toSalesVehicle(row, query.locale, await readFxQuote(tx)), asOf,
        configuration: { items: configuration.items, total: configuration.total,
          nextCursor: next < configuration.total
            ? encode({ version: 1, binding: vehicleBinding, revision: configuration.revision, offset: next }) : null } };
    });
  }
}
