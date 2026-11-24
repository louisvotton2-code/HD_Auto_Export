import { keywordScopeGuard } from './keyword-scope-indexes.js';

export type KeywordScopeParameters = Partial<Record<'make' | 'model', string>>;

/** Accept only bind placeholders and the literal predicate assembled by the catalog. */
export function keywordScopeHits(locale:'en'|'ru', scope:KeywordScopeParameters, literalPredicate:string) {
  const columns='listing_id,published_at,make_id,model_id,trim_id,generation_id,model_year,drivetrain,powertrain,label_order';
  const table=`public.external_catalog_keyword_match_${locale}`;
  const guard=keywordScopeGuard('k');
  const terms=(['make','model'] as const).flatMap(name => {
    const parameter=scope[name];
    return parameter ? [{column:`k.${name}_id`,parameter}] : [];
  });
  const equal=terms.map(({column,parameter})=>` AND ${column}=${parameter}`).join('');
  const hashes=terms.map(({column,parameter})=>` AND md5(${column})=md5(${parameter}::text)`).join('');
  // Fence each scoped read before the LIKE predicate. With a one- or two-character
  // substring the GIN posting scan could otherwise drive the whole language.
  const read=(restriction:string)=>`SELECT ${columns} FROM (
    SELECT ${columns},search_document FROM ${table} k WHERE $1::text='${locale}' AND ${restriction} OFFSET 0
  ) s WHERE true${literalPredicate}`;
  // The raw equality check in the overflow arm also covers hash collisions and
  // records with only one overwide key. Both arms use the precise same text test.
  return `${read(`(${guard})${equal}`)} UNION ALL ${read(`NOT (${guard})${hashes}${equal}`)}`;
}
