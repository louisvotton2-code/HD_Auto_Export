import type { PoolClient } from 'pg';
import {
  PublicVehicleSchema, type ExternalIssue, type Locale, type PublicFilterQuery, type PublicMedia, type PublicVehicle, type VehicleDisplay,
} from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { displayText, publicText, type ExternalProjection } from './normalize.js';

export const publicListingId = (id: string) => `ext-${id}`;
export const listingUuid = (id: string) => id.slice(4);
export const publicMediaId = (id: string) => `ximg-${id}`;
const stockCode = (id: string) => `EXT-${id.toUpperCase()}`;
type Queryable = Pick<Database['pool'] | PoolClient, 'query'>;
type CatalogRow = {
  listing_id: string; platform_id: string; platform_name: string; listing_url: string;
  facts: ExternalProjection['facts']; price_cny: string | null; issues: ExternalIssue[];
  localized: ExternalProjection['localized'][Locale]; details?: ExternalProjection['details'];
  fetched_at: Date; source_updated_at: Date | null; published_at: Date;
};
type ImageRow = {
  id: string; listing_id: string; url: string; alt: ExternalProjection['images'][number]['alt'];
  width: number | null; height: number | null; position: number; revision: number; refreshed_at: Date; expires_at: Date | null;
};
const iso = (value: Date | null) => value?.toISOString() ?? null;
const localizedFacts = (facts: CatalogRow['facts'], display: VehicleDisplay): CatalogRow['facts'] => ({
  ...facts,
  make: facts.make && { ...facts.make, name: display.make.text ?? facts.make.name },
  model: facts.model && { ...facts.model, name: display.model.text ?? facts.model.name },
  trim: facts.trim && { ...facts.trim, name: display.trim.text ?? facts.trim.name },
  generation: facts.generation && { ...facts.generation, name: display.generation.text ?? facts.generation.name },
  location: facts.location && { ...facts.location, city: display.city.text, displayName: display.location.text },
});

function toPublic(row: CatalogRow, photos: ImageRow[], locale: Locale, time: number): PublicVehicle {
  const issues = [...row.issues];
  const available = photos.filter(photo => !photo.expires_at || photo.expires_at.getTime() > time);
  if (available.length !== photos.length && !issues.some(issue => issue.field === 'images')) issues.push({ field: 'images', code: 'expired' });
  const images: PublicMedia[] = available.map((photo, i) => ({
    id: publicMediaId(photo.id), url: photo.url, alt: photo.alt?.text ?? '', width: photo.width, height: photo.height,
    sortOrder: photo.position, isCover: i === 0,
    remote: { revision: photo.revision, refreshedAt: photo.refreshed_at.toISOString(), expiresAt: iso(photo.expires_at) },
  }));
  const { title, description } = row.localized;
  const display = { ...row.localized.display, mediaAlt: available.map(photo => ({ mediaId: publicMediaId(photo.id), value: displayText(locale, photo.alt) })) };
  const id = publicListingId(row.listing_id);
  const detail = row.details;
  const original = (field: keyof ExternalProjection['details']['original']) => {
    const value = detail?.original[field];
    return value ? publicText(locale, value) : null;
  };
  return PublicVehicleSchema.parse({
    id, stockCode: stockCode(row.listing_id), detailPath: `/${locale}/cars/${id}/`,
    source: { kind: 'external', platform: { id: row.platform_id, name: row.platform_name }, listingUrl: row.listing_url },
    facts: localizedFacts(row.facts, display), display,
    price: row.price_cny === null ? { kind: 'on_request', money: null, includes: [] } :
      { kind: 'reference', money: { amount: row.price_cny, currency: 'CNY' }, includes: [] },
    content: { title, description }, images,
    availability: 'unknown', availabilityCheckedAt: null, sourceUpdatedAt: iso(row.source_updated_at),
    fetchedAt: row.fetched_at.toISOString(), publishedAt: row.published_at.toISOString(),
    external: {
      issues,
      ...(detail ? { detail: { ...detail, original: { title: original('title'), model: original('model'), description: original('description') } } } : {}),
    },
  });
}

function matches(query: PublicFilterQuery) {
  const values: unknown[] = [query.locale];
  const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const where: string[] = [];
  for (const key of ['make', 'model', 'trim', 'generation'] as const) if (query[key]) where.push(`c.facts->'${key}'->>'id'=${param(query[key])}`);
  if (query.drivetrain) where.push(`c.facts->>'drivetrain'=${param(query.drivetrain)}`);
  if (query.powertrain === 'unknown') where.push('false');
  else if (query.powertrain) where.push(`c.facts->>'powertrain'=${param(query.powertrain)}`);
  for (const [min, max, column] of [
    ['priceMin', 'priceMax', 'c.price_cny'], ['yearMin', 'yearMax', "(c.facts->>'modelYear')::integer"],
    ['mileageMin', 'mileageMax', "(c.facts->>'mileageKm')::integer"],
  ] as const) {
    if (query[min] !== undefined) where.push(`${column}>=${param(query[min])}`);
    if (query[max] !== undefined) where.push(`${column}<=${param(query[max])}`);
  }
  if ((query.priceMin !== undefined || query.priceMax !== undefined) && query.priceCurrency !== 'CNY') where.push('false');
  if (query.q) {
    const text = param(query.q);
    const fields = ["'EXT-' || c.listing_id::text", "c.localized->$1::text->'display'->'make'->>'text'", "c.localized->$1::text->'display'->'model'->>'text'", "c.localized->$1::text->'title'->>'text'"];
    where.push(`(${fields.map(field => `strpos(lower(coalesce(${field},'')),lower(${text}))>0`).join(' OR ')})`);
  }
  return { where: where.length ? ` AND ${where.join(' AND ')}` : '', values };
}

const columns = `c.listing_id,c.published_at,c.platform_name,c.listing_url,c.facts,c.price_cny,c.issues,
  c.localized->$1::text AS localized,l.platform_id,l.fetched_at,l.source_updated_at`;
const from = 'FROM external_catalog c JOIN external_listings l ON l.id=c.listing_id';
// Catalogue rows only exist for visible listings. This second predicate is also useful when repairing projections.
const visible = "WHERE l.upstream_state='active' AND c.localized ? $1::text";
const ordered = 'ORDER BY c.published_at DESC,c.listing_id';

async function materialize(tx: Queryable, rows: CatalogRow[], locale: Locale, time: number) {
  if (!rows.length) return [];
  const photos = await tx.query<ImageRow>(`SELECT id,listing_id,url,alt,width,height,position,revision,refreshed_at,expires_at
    FROM external_media WHERE active AND listing_id=ANY($1::uuid[]) ORDER BY listing_id,position,id`, [rows.map(row => row.listing_id)]);
  const images = new Map<string, ImageRow[]>();
  for (const photo of photos.rows) {
    const listingImages = images.get(photo.listing_id) ?? [];
    listingImages.push(photo);
    images.set(photo.listing_id, listingImages);
  }
  return rows.map(row => toPublic(row, images.get(row.listing_id) ?? [], locale, time));
}

export async function getExternalPublic(tx: Queryable, id: string, locale: Locale, time = Date.now()) {
  const result = await tx.query<CatalogRow>(`SELECT ${columns},c.details ${from} ${visible} AND c.listing_id=$2`, [locale, id]);
  return (await materialize(tx, result.rows, locale, time))[0] ?? null;
}
export async function countExternal(tx: Queryable, query: PublicFilterQuery): Promise<number> {
  const { where, values } = matches(query);
  const result = await tx.query<{ total: number }>(`SELECT count(*)::int AS total ${from} ${visible}${where}`, values);
  return result.rows[0]!.total;
}
export async function listExternal(tx: Queryable, query: PublicFilterQuery, limit: number, offset: number, time: number) {
  const { where, values } = matches(query);
  const result = await tx.query<CatalogRow>(`SELECT ${columns} ${from} ${visible}${where} ${ordered}
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
  return materialize(tx, result.rows, query.locale, time);
}
export async function externalFacetRows(tx: Queryable, query: PublicFilterQuery) {
  const { where, values } = matches(query);
  const result = await tx.query<{ facts: CatalogRow['facts']; display: VehicleDisplay; price_cny: string | null }>(
    `SELECT c.facts,c.price_cny,c.localized->$1::text->'display' AS display ${from} ${visible}${where} ${ordered}`, values,
  );
  return result.rows.map(row => ({
    facts: localizedFacts(row.facts, row.display),
    price: { money: row.price_cny === null ? null : { currency: 'CNY' as const } },
  }));
}

export async function reportMediaFailure(db: Database, mediaId: string, revision: number) {
  const result = await db.pool.query<{ found: boolean; queued: boolean }>(`WITH eligible AS (
    SELECT m.id,m.revision FROM external_media m JOIN external_catalog c ON c.listing_id=m.listing_id
    WHERE m.id=$1 AND m.active AND m.revision=$2
  ), queued AS (
    INSERT INTO external_media_refresh_requests(media_id,media_revision) SELECT id,revision FROM eligible
    ON CONFLICT DO NOTHING RETURNING media_id
  ) SELECT EXISTS(SELECT FROM eligible) AS found, EXISTS(SELECT FROM queued) AS queued`, [mediaId, revision]);
  return result.rows[0]!;
}
