import { pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';
import type { Database } from '../db/index.js';

type Queryable = Pick<Database['pool'] | PoolClient, 'query'>;
type ScopeLocale = 'en' | 'ru';
const indexKinds = ['cover', 'overflow'] as const;
type IndexKind = (typeof indexKinds)[number];
const boundedColumns = [
  ['make_id', 100],
  ['model_id', 100],
  ['trim_id', 100],
  ['generation_id', 100],
  ['drivetrain', 32],
  ['powertrain', 32],
] as const;

/** Keep included values below the B-tree tuple limit. The overflow arm is its exact complement. */
export function keywordScopeGuard(alias?: string): string {
  if (alias !== undefined && !/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error('Invalid SQL alias');
  const prefix = alias ? alias + '.' : '';
  return [
    `(octet_length(${prefix}search_document) <= 1024)`,
    ...boundedColumns.map(([column, limit]) => `(COALESCE(octet_length(${prefix}${column}), 0) <= ${limit})`),
    `(octet_length(${prefix}label_order) <= 64)`,
  ].join(' AND ');
}

type IndexDefinition = {
  kind: IndexKind;
  name: string;
  child: string;
  definition: string;
  concurrent: string;
};

export function scopedKeywordIndexDefinitions(locale: ScopeLocale): IndexDefinition[] {
  if (locale !== 'en' && locale !== 'ru') throw new Error('Expected English or Russian scope index');
  const child = `external_catalog_keyword_match_${locale}`;
  const guard = keywordScopeGuard();
  const definitions: Record<IndexKind, string> = {
    cover: `(make_id, model_id) INCLUDE (listing_id, search_document, published_at, trim_id, generation_id, model_year, drivetrain, powertrain, label_order) WHERE (${guard})`,
    overflow: `(md5(make_id), md5(model_id)) WHERE (NOT (${guard}))`,
  };
  return indexKinds.map(kind => {
    const name = `external_catalog_kw_scope_${locale}_${kind}_idx`;
    const on = `ON public.${child} USING btree ${definitions[kind]}`;
    return {
      kind, name, child,
      definition: `CREATE INDEX ${name} ${on}`,
      concurrent: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ${on};`,
    };
  });
}

const verifiedPartition = (child: string, bound: string) => `
  current_setting('block_size')::int >= 8192
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_inherits inheritance
    JOIN pg_catalog.pg_class child ON child.oid=inheritance.inhrelid
    JOIN pg_catalog.pg_class parent ON parent.oid=inheritance.inhparent
    WHERE child.oid=pg_catalog.to_regclass(${child})
      AND parent.oid=pg_catalog.to_regclass('public.external_catalog_keyword_match')
      AND child.relkind='r' AND child.relispartition AND parent.relkind='p'
      AND NOT inheritance.inhdetachpending
      AND pg_catalog.pg_get_expr(child.relpartbound, child.oid)=${bound}
  )`;

const verifiedIndex = (child: string, name: string, qualified: string, visible: string) => `EXISTS (
  SELECT 1 FROM pg_catalog.pg_index i
  WHERE i.indexrelid=pg_catalog.to_regclass(${name}) AND i.indrelid=pg_catalog.to_regclass(${child})
    AND i.indisvalid AND i.indisready AND i.indislive
    AND pg_catalog.pg_get_indexdef(i.indexrelid) IN (${qualified}, ${visible})
)`;

function partitionBound(locale: ScopeLocale) {
  return `FOR VALUES IN ('${locale}')`;
}

function visibleDefinition(index: IndexDefinition) {
  return index.definition.replace(` ON public.${index.child} `, ` ON ${index.child} `);
}

/** A partially built, detached or different index stays on the existing exact query. */
export async function scopedKeywordIndexesReady(tx: Queryable, locale: ScopeLocale): Promise<boolean> {
  const indexes = scopedKeywordIndexDefinitions(locale);
  const child = `public.${indexes[0]!.child}`;
  const result = await tx.query<{ ready: boolean }>(
    `SELECT (${verifiedPartition('$1::text', '$2::text')}
      AND NOT EXISTS (
        SELECT 1 FROM unnest($3::text[], $4::text[], $5::text[]) AS expected(name, qualified, visible)
        WHERE NOT ${verifiedIndex('$1::text', 'expected.name', 'expected.qualified', 'expected.visible')}
      )
    ) AS ready`,
    [child, partitionBound(locale), indexes.map(index => `public.${index.name}`),
      indexes.map(index => index.definition), indexes.map(visibleDefinition)],
  );
  return result.rows[0]?.ready === true;
}

const literal = (text: string) => "'" + text.replaceAll("'", "''") + "'";

/** Emits one psql program with no embedded connection information or automatic cleanup. */
export function scopedKeywordIndexBuildSql(locale: ScopeLocale, kind: IndexKind): string {
  const index = scopedKeywordIndexDefinitions(locale).find(definition => definition.kind === kind);
  if (!index) throw new Error('Expected cover or overflow');
  const child = literal(`public.${index.child}`);
  const name = literal(`public.${index.name}`);
  const indexReady = verifiedIndex(child, name, literal(index.definition), literal(visibleDefinition(index)));
  return [
    '-- Run with psql in autocommit mode. Each invocation can build one index.',
    '\\set ON_ERROR_STOP on',
    'SET search_path = pg_catalog;',
    "SET lock_timeout = '2s';",
    "SET statement_timeout = '90s';",
    `DO $preflight$
BEGIN
  IF NOT (${verifiedPartition(child, literal(partitionBound(locale)))}) THEN
    RAISE EXCEPTION 'Keyword scope partition or block size does not match';
  END IF;
  IF pg_catalog.to_regclass(${name}) IS NOT NULL AND NOT ${indexReady} THEN
    RAISE EXCEPTION 'Existing keyword scope index is invalid or has a different definition';
  END IF;
END
$preflight$;`,
    index.concurrent,
    `DO $verify$
BEGIN
  IF NOT (${verifiedPartition(child, literal(partitionBound(locale)))}) OR NOT ${indexReady} THEN
    RAISE EXCEPTION 'Keyword scope index is not ready after build';
  END IF;
END
$verify$;`,
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [locale, kind, ...extra] = process.argv.slice(2);
  if ((locale !== 'en' && locale !== 'ru') || !indexKinds.includes(kind as IndexKind) || extra.length) {
    throw new Error('Usage: keyword-scope-indexes <en|ru> <cover|overflow>');
  }
  process.stdout.write(scopedKeywordIndexBuildSql(locale, kind as IndexKind));
}
