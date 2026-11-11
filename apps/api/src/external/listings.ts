import type { ExternalListingListQuery, ExternalListingSummary, ExternalOverrides, ExternalUpsertCandidate } from '@hd/contracts/admin';
import type { Database } from '../db/index.js';
import { literalPattern, publicListingId } from './catalog.js';
import { eligibleTextOverride, sourceCopy, sourceHashes, type TextSourceIdentities } from './normalize.js';

type ListingRow = {
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
};

const from = 'FROM external_listings l LEFT JOIN external_listing_overrides o ON o.listing_id=l.id';
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
  if (query.q) {
    const id = searchListingId(query.q);
    if (id) conditions.push('l.id=' + param(id) + '::uuid');
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
    const result = await tx.query<ListingRow>("SELECT l.id,l.version,l.provider,l.platform_id,l.external_id,l.source_data,o.data AS overrides,o.text_source_identities,"
      + state + " AS state,l.fetched_at,l.source_updated_at,l.published_at," + hasOverrides + " AS has_overrides "
      + from + " " + where + " ORDER BY l.fetched_at DESC,l.id LIMIT $" + (values.length + 1) + " OFFSET $" + (values.length + 2),
      [...values, pageSize, offset]);
    const items = result.rows.map((row): ExternalListingSummary => ({
      id: publicListingId(row.id),
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
    }));
    return { page, pageSize, total, items };
  });
}
