import {SUPPORTED_CURRENCIES,type Currency,type PublicPrice,type PublicUsdPrice} from '@hd/contracts/public';
import type {FxQuote} from '../external/fx.js';

const maximumCents=9_999_999_999_999_999n;
const cents=(value:string)=>{const [whole,fraction='']=value.split('.');return BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));};
const amount=(value:bigint)=>`${value/100n}.${(value%100n).toString().padStart(2,'0')}`;
function rate(currency:Currency,quote:FxQuote|null):{numerator:bigint;denominator:bigint}|null {
  if(currency==='USD')return {numerator:1n,denominator:1n};
  const value=quote?.rates[currency];
  if(!value||value.length>64||!/^\d+(?:\.\d+)?$/.test(value))return null;
  const [whole,fraction='']=value.split('.'),numerator=BigInt(whole!+fraction);
  return numerator>0n?{numerator,denominator:10n**BigInt(fraction.length)}:null;
}
/** Rates mean original currency units per USD. All rounding is non-negative half-up to cents. */
export function projectUsdPrice(price:PublicPrice,quote:FxQuote|null):PublicUsdPrice {
  if(price.kind==='on_request')return {status:'on_request',money:null,conversion:null};
  const divisor=rate(price.money.currency,quote);
  if(!divisor)return {status:'unavailable',money:null,conversion:null,reason:'rate_unavailable'};
  const converted=(2n*cents(price.money.amount)*divisor.denominator+divisor.numerator)/(2n*divisor.numerator);
  if(converted>maximumCents)return {status:'unavailable',money:null,conversion:null,reason:'amount_out_of_range'};
  return {status:'ready',kind:price.money.currency==='USD'?price.kind:'reference',money:{amount:amount(converted),currency:'USD'},
    conversion:price.money.currency==='USD'?null:{asOf:quote!.asOf,source:quote!.source}};
}
const ceil=(numerator:bigint,denominator:bigint)=>numerator>=0n?(numerator+denominator-1n)/denominator:numerator/denominator;
export type UsdSourceRange={currency:Currency;minimum:string;maximum:string};
/** Exact inverse of rounded USD cents: [L-.5,U+.5), intersected with supported source money. */
export function usdSourceRange(currency:Currency,quote:FxQuote|null,minimum='0',maximum='99999999999999.99'):UsdSourceRange|null {
  const divisor=rate(currency,quote);if(!divisor)return null;
  const lower=ceil((2n*cents(minimum)-1n)*divisor.numerator,2n*divisor.denominator);
  const upper=ceil((2n*cents(maximum)+1n)*divisor.numerator,2n*divisor.denominator)-1n;
  const from=lower<0n?0n:lower,to=upper>maximumCents?maximumCents:upper;
  return from<=to?{currency,minimum:amount(from),maximum:amount(to)}:null;
}
export function usdSourceRanges(quote:FxQuote|null,minimum?:string,maximum?:string):UsdSourceRange[] {
  return SUPPORTED_CURRENCIES.flatMap(currency=>{const range=usdSourceRange(currency,quote,minimum,maximum);return range?[range]:[];});
}
/** Same guarded expression as migration 0010; invalid historical prices cannot break migration or filters. */
export const staffPriceAmountSql="CASE WHEN p.data->'price'->'money'->>'amount' ~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,2})?$' THEN (p.data->'price'->'money'->>'amount')::numeric END";
export function staffUsdCondition(params:unknown[],quote:FxQuote|null,minimum?:string,maximum?:string):string {
  const ranges=usdSourceRanges(quote,minimum,maximum);
  return `(${ranges.map(range=>{
    params.push(range.currency,range.minimum,range.maximum);const n=params.length;
    return `(p.data->'price'->'money'->>'currency'=$${n-2} AND (${staffPriceAmountSql})>=$${n-1}::numeric AND (${staffPriceAmountSql})<=$${n}::numeric)`;
  }).join(' OR ')||'false'})`;
}
