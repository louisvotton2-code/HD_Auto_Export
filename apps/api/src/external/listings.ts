import { externalActivitySql } from '../activity/service.js';
import type { AdminActivitySummary } from '@hd/contracts/admin';
import type { ExternalListingListQuery, ExternalListingSummary, ExternalOverrides, ExternalUpsertCandidate } from '@hd/contracts/admin';
import type { Database } from '../db/index.js';
import { literalPattern, publicListingId } from './catalog.js';
import { eligibleTextOverride, sourceCopy, sourceHashes, type TextSourceIdentities } from './normalize.js';

type ListingRow = {
  activity: AdminActivitySummary;
  id: string;
  version: number;
  provider: string;
  platform_id: string;
  external_id: string;
  source_data: ExternalUpsertCandidate | null;
  overrides: ExternalOverrides | null;
  text_source_identities: TextSourceIdentities | null;
  state: ExternalListingSummary['state'];
  fetched_at: Date;
  source_updated_at: Date | null;
  published_at: Date | null;
  has_overrides: boolean;
  catalog_facts: ExternalUpsertCandidate['facts'] | null;
};

const from = 'FROM external_listings l LEFT JOIN external_listing_overrides o ON o.listing_id=l.id';
// Classify the stored source facts and staff values consistently in every visibility state.
const facts = "(((l.source_data->'facts') - ARRAY(SELECT jsonb_array_elements_text(l.source_data->'disputes'))) "
  + "|| COALESCE(o.data->'facts','{}'::jsonb))";
const powertrain = `COALESCE(${facts}->>'powertrain','unknown')`;
const hidden = "(o.data->'hidden' = 'true'::jsonb)";
const state = "CASE WHEN l.upstream_state='withdrawn' THEN 'withdrawn' WHEN " + hidden + " THEN 'hidden' ELSE 'published' END";
const hasOverrides = "(" + hidden + " IS TRUE"
  + " OR CASE WHEN jsonb_typeof(o.data->'facts')='object' THEN o.data->'facts'<>'{}'::jsonb ELSE false END"
  + " OR CASE WHEN jsonb_typeof(o.data->'text')='array' THEN o.data->'text'<>'[]'::jsonb ELSE false END)";
const exactListingId = /^(?:ext-|\/(?:zh|en|ru)\/cars\/ext-)([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i;

function searchListingId(value: string): string | undefined {
  const direct = exactListingId.exec(value)?.[1];
  if (direct) return direct;
  if (!/^https?:\/\//i.test(value)) return;
  const url = URL.parse(value);
  if (!url || url.username || url.password) return;
  return exactListingId.exec(url.pathname)?.[1];
}

function listingTitle(row: ListingRow, locale: ExternalListingListQuery['locale']): string | null {
  if (!row.source_data) return null;
  const copy = sourceCopy(row.source_data);
  if (!copy.title) return null;
  const edit = row.overrides && eligibleTextOverride(
    row.source_data, row.overrides, row.text_source_identities ?? {}, 'title', locale, sourceHashes(row.source_data, copy).title,
  );
  if (edit) return edit.text;
  const { original, translations } = copy.title;
  return original.contentLocale.split('-')[0] === locale ? original.text : translations[locale]?.text ?? original.text;
}

function searchWhere(query: ExternalListingListQuery, values: unknown[]): string {
  const param = (value: unknown) => { values.push(value); return '$' + values.length; };
  const conditions = [];
  if (query.platformId) conditions.push('l.platform_id=' + param(query.platformId));
  if (query.state === 'withdrawn') conditions.push("l.upstream_state='withdrawn'");
  else if (query.state) {
    conditions.push("l.upstream_state='active'", hidden + (query.state === 'hidden' ? ' IS TRUE' : ' IS NOT TRUE'));
  }
  if (query.make) conditions.push(`${facts}->'make'->>'id'=${param(query.make)}`);
  if (query.model) conditions.push(`${facts}->'model'->>'id'=${param(query.model)}`);
  if (query.powertrain) conditions.push(`${facts} IS NOT NULL AND ${powertrain}=${param(query.powertrain)}`);
  if (query.yearMin !== undefined) conditions.push(`(${facts}->>'modelYear')::int>=${param(query.yearMin)}`);
  if (query.yearMax !== undefined) conditions.push(`(${facts}->>'modelYear')::int<=${param(query.yearMax)}`);
  if (query.mileageMax !== undefined) conditions.push(`(${facts}->>'mileageKm')::int<=${param(query.mileageMax)}`);
  if (query.q) {
    const short=/^(che168|dongchedi)-([0-9]+)$/.exec(query.q);
    const id = searchListingId(query.q);
    if(short)conditions.push('l.platform_id='+param(short[1])+' AND l.external_id='+param(short[2]));
    else if (id) conditions.push('l.id=' + param(id) + '::uuid');
    else {
      const pattern = param(literalPattern(query.q));
      // A line break can otherwise create an accidental cross-field match in
      // the trigram document. Check it against each field independently.
      const literal = query.q.includes('\n') ? param(query.q) : null;
      const contains = (terms: string) => "external_listing_admin_search_document(" + terms + ") LIKE lower(" + pattern + ") ESCAPE E'\\\\'" +
        (literal ? ' AND EXISTS(SELECT 1 FROM unnest(' + terms + ') AS term(value) WHERE strpos(lower(term.value),lower(' + literal + '))>0)' : '');
      conditions.push("l.id IN ("
        + "SELECT s.id FROM external_listings s WHERE " + contains('external_listing_admin_source_terms(s.id,s.external_id,s.source_data)')
        + " UNION SELECT a.listing_id FROM external_listing_overrides a WHERE " + contains('external_listing_admin_override_terms(a.data)') + ")");
    }
  }
  return conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
}

export async function listExternalListings(db: Database, query: ExternalListingListQuery) {
  const { page, pageSize, locale } = query;
  const values: unknown[] = [];
  const where = searchWhere(query, values);
  return db.transaction(async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const count = await tx.query<{ total: number }>('SELECT count(*)::int AS total ' + from + ' ' + where, values);
    const total = count.rows[0]!.total;
    const offset = (page - 1) * pageSize;
    if (offset >= total) return { page, pageSize, total, items: [] };
    const result = await tx.query<ListingRow>(`SELECT ${externalActivitySql()} AS activity,l.id,l.version,l.provider,l.platform_id,l.external_id,l.source_data,o.data AS overrides,o.text_source_identities,`
      + facts + " AS catalog_facts," + state + " AS state,l.fetched_at,l.source_updated_at,l.published_at," + hasOverrides + " AS has_overrides "
      + from + " " + where + " ORDER BY l.fetched_at DESC,l.id LIMIT $" + (values.length + 1) + " OFFSET $" + (values.length + 2),
      [...values, pageSize, offset]);
    const items = result.rows.map((row): ExternalListingSummary => ({
      activity:row.activity,id: publicListingId(row.id),inquiryCode:`${row.platform_id}-${row.external_id}`,
      version: row.version,
      provider: row.provider,
      platformId: row.platform_id,
      externalId: row.external_id,
      listingUrl: row.source_data?.listingUrl ?? null,
      title: listingTitle(row, locale),
      state: row.state,
      fetchedAt: row.fetched_at.toISOString(),
      sourceUpdatedAt: row.source_updated_at?.toISOString() ?? null,
      publishedAt: row.published_at?.toISOString() ?? null,
      hasOverrides: row.has_overrides,
      facts: row.catalog_facts ? {
        make: row.catalog_facts.make ?? null,
        model: row.catalog_facts.make ? row.catalog_facts.model ?? null : null,
        modelYear: row.catalog_facts.modelYear ?? null,
        mileageKm: row.catalog_facts.mileageKm ?? null,
        powertrain: row.catalog_facts.powertrain ?? 'unknown',
      } : null,
    }));
    return { page, pageSize, total, items };
  });
}

export async function getExternalListingOverview(db: Database, make?: string) {
  const { rows } = await db.pool.query<{ kind: 'state' | 'platform' | 'make' | 'model' | 'year'; id: string; name: string | null; count: number }>(`
    SELECT facet.kind,facet.id,min(facet.name COLLATE "C") AS name,count(*)::int AS count
    ${from}
    CROSS JOIN LATERAL (VALUES
      ('state',${state},NULL::text),
      ('platform',l.platform_id,NULL::text),
      ('make',${facts}->'make'->>'id',${facts}->'make'->>'name'),
      ('year',${facts}->>'modelYear',NULL::text),
      ('model',CASE WHEN ${facts}->'make'->>'id'=$1 THEN ${facts}->'model'->>'id' END,${facts}->'model'->>'name')
    ) AS facet(kind,id,name)
    WHERE facet.id IS NOT NULL
    GROUP BY facet.kind,facet.id
    ORDER BY name NULLS LAST,facet.id
  `, [make ?? null]);
  const counts = new Map(rows.filter(row => row.kind === 'state').map(row => [row.id, row.count]));
  const published = counts.get('published') ?? 0;
  const hidden = counts.get('hidden') ?? 0;
  const withdrawn = counts.get('withdrawn') ?? 0;
  const options = (kind: 'make' | 'model') => rows.filter(row => row.kind === kind)
    .map(({ id, name }) => ({ id, name: name ?? id }));
  return {
    total: published + hidden + withdrawn, published, hidden, withdrawn,
    platforms: rows.filter(row => row.kind === 'platform').map(row => row.id),
    makes: options('make'), models: options('model'),
    years: rows.filter(row => row.kind === 'year').map(row => Number(row.id)).sort((a, b) => b - a),
  };
}
