import { z } from 'zod';
import type { Locale } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { isPublicText } from './normalize.js';

export const SearchReprojectOptions = z.strictObject({
  after: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

type SearchSource = {
  listing_id: string;
  locale: Locale | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  generation: string | null;
  title: string | null;
  fact_make: string | null;
  fact_model: string | null;
  fact_trim: string | null;
  fact_generation: string | null;
};

const textLimit = 500;
// Read one over the supported bound so malformed historical scalars are discarded rather than truncated into public words.
const boundedText = (expression: string) =>
  `CASE WHEN jsonb_typeof(${expression})='string' THEN left(${expression} #>> '{}',${textLimit+1}) END`;
const safeTerm = (text: string | null) => text && text.length <= textLimit && isPublicText(text) ? text : null;

/** Repair only existing public search rows, never the listing, overrides or source evidence. */
export async function reprojectStoredSearch(db: Database, input: z.input<typeof SearchReprojectOptions>) {
  const { after, limit } = SearchReprojectOptions.parse(input);
  const cursorFilter = after ? 'WHERE listing_id>$2::uuid' : '';
  return db.transaction(async tx => {
    await tx.query("SET LOCAL lock_timeout='1s'");
    await tx.query("SET LOCAL statement_timeout='5s'");
    // Keep the source snapshot and the search write in the same supplier writer transaction.
    await tx.query('SELECT pg_advisory_xact_lock(78291332)');
    const { rows } = await tx.query<SearchSource>(`WITH picked AS MATERIALIZED (
      SELECT listing_id FROM external_catalog ${cursorFilter}
      ORDER BY listing_id LIMIT $1
    ) SELECT p.listing_id,s.locale,
      ${boundedText("localized.data#>'{display,make,text}'")} AS make,
      ${boundedText("localized.data#>'{display,model,text}'")} AS model,
      ${boundedText("localized.data#>'{display,trim,text}'")} AS trim,
      ${boundedText("localized.data#>'{display,generation,text}'")} AS generation,
      ${boundedText("localized.data#>'{title,text}'")} AS title,
      ${boundedText("c.facts#>'{make,name}'")} AS fact_make,
      ${boundedText("c.facts#>'{model,name}'")} AS fact_model,
      ${boundedText("c.facts#>'{trim,name}'")} AS fact_trim,
      ${boundedText("c.facts#>'{generation,name}'")} AS fact_generation
    FROM picked p
    LEFT JOIN external_listings l ON l.id=p.listing_id AND l.provider='chinacarapi'
    LEFT JOIN external_catalog c ON c.listing_id=l.id
    LEFT JOIN external_catalog_search s ON s.listing_id=c.listing_id
    CROSS JOIN LATERAL (SELECT c.localized->s.locale AS data) localized
    ORDER BY p.listing_id,s.locale`, after ? [limit, after] : [limit]);

    const terms = rows.flatMap(row => {
      if (!row.locale) return [];
      const make = safeTerm(row.make);
      const model = safeTerm(row.model);
      return [{ listing_id: row.listing_id, locale: row.locale,
        make_label: make ?? safeTerm(row.fact_make), model_label: model ?? safeTerm(row.fact_model),
        trim_label: safeTerm(row.trim) ?? safeTerm(row.fact_trim),
        generation_label: safeTerm(row.generation) ?? safeTerm(row.fact_generation),
        stock_text: `EXT-${row.listing_id.toUpperCase()}`, make_text: make ?? '', model_text: model ?? '',
        title_text: safeTerm(row.title) ?? '' }];
    });
    let changedRows = 0;
    if (terms.length) {
      const result = await tx.query(`UPDATE external_catalog_search s SET
        make_label=p.make_label,model_label=p.model_label,trim_label=p.trim_label,generation_label=p.generation_label,
        stock_text=p.stock_text,make_text=p.make_text,model_text=p.model_text,title_text=p.title_text
      FROM jsonb_to_recordset($1::jsonb) AS p(listing_id uuid,locale text,
        make_label text,model_label text,trim_label text,generation_label text,
        stock_text text,make_text text,model_text text,title_text text)
      WHERE s.listing_id=p.listing_id AND s.locale=p.locale AND
        ROW(s.make_label,s.model_label,s.trim_label,s.generation_label,s.stock_text,s.make_text,s.model_text,s.title_text)
        IS DISTINCT FROM
        ROW(p.make_label,p.model_label,p.trim_label,p.generation_label,p.stock_text,p.make_text,p.model_text,p.title_text)`,
      [JSON.stringify(terms)]);
      changedRows = result.rowCount ?? 0;
      // Search matches and exposed labels feed both catalog and facet responses.
      if (changedRows) await tx.query('SELECT queue_public_catalog_change()');
    }
    const scanned = new Set(rows.map(row => row.listing_id)).size;
    return { scanned, changedRows, nextCursor: scanned === limit ? rows.at(-1)!.listing_id : null };
  });
}
