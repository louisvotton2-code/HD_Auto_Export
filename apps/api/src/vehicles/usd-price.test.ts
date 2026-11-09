import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Currency,PublicPrice} from '@hd/contracts/public';
import {projectUsdPrice,usdSourceRange,usdSourceRanges} from './usd-price.js';
import type {FxQuote} from '../external/fx.js';
const quote=(rate='7.2'):FxQuote=>({version:'synthetic-review',asOf:'2026-11-10T00:00:00Z',expiresAt:'2099-11-10T00:00:00Z',source:'synthetic',rates:{USD:'1',CNY:rate}});
const price=(amount:string,currency:Currency='CNY'):PublicPrice=>({kind:'asking',money:{amount,currency},includes:[]});
const money=(value:ReturnType<typeof projectUsdPrice>)=>value.status==='ready'?value.money.amount:null;
const asCents=(value:string)=>{const [whole,part='']=value.split('.');return BigInt(whole!)*100n+BigInt(part.padEnd(2,'0'));};
const amount=(value:bigint)=>`${value/100n}.${String(value%100n).padStart(2,'0')}`;
test('USD half-up conversion preserves native quotation kinds and never rewrites source data',()=>{
  const source=price('100000.00');assert.equal(money(projectUsdPrice(source,quote())),'13888.89');assert.equal(source.money!.amount,'100000.00');
  const converted=projectUsdPrice(source,quote());assert.equal(converted.status,'ready');if(converted.status==='ready'){assert.equal(converted.kind,'reference');assert.deepEqual(converted.conversion,{asOf:quote().asOf,source:'synthetic'});}
  assert.deepEqual(projectUsdPrice(price('1','USD'),null),{status:'ready',kind:'asking',money:{amount:'1.00',currency:'USD'},conversion:null});
  assert.equal(money(projectUsdPrice(price('2.01'),quote('2'))),'1.01');
  assert.equal(money(projectUsdPrice(price('2.00'),quote('2'))),'1.00');
  assert.equal(money(projectUsdPrice(price('0'),quote())),'0.00');
});
test('inverse boundaries include lower half-cent ties and exclude upper ties exactly',()=>{
  assert.deepEqual(usdSourceRange('CNY',quote(),'13.89','13.89'),{currency:'CNY',minimum:'99.98',maximum:'100.04'});
  assert.deepEqual(usdSourceRange('CNY',quote('2'),'1.00','1.00'),{currency:'CNY',minimum:'1.99',maximum:'2.00'});
  for(const rate of ['2','7.2','0.5','7.200001','160.23456789','0.00000001'])for(const [low,high] of [['0','0'],['0','1'],['1.00','1.01'],['13.89','13.89'],['99999999999999.99','99999999999999.99']]){
    const fx=quote(rate),range=usdSourceRange('CNY',fx,low,high),points=new Set<bigint>([0n,1n,199n,200n,201n,9997n,9998n,10004n,10005n,9_999_999_999_999_999n]);
    if(range)for(const edge of [asCents(range.minimum),asCents(range.maximum)])for(const delta of [-1n,0n,1n])if(edge+delta>=0n&&edge+delta<=9_999_999_999_999_999n)points.add(edge+delta);
    for(const k of points){const display=money(projectUsdPrice(price(amount(k)),fx));const actual=display!==null&&asCents(display)>=asCents(low!)&&asCents(display)<=asCents(high!);
      const matches=!!range&&k>=asCents(range.minimum)&&k<=asCents(range.maximum);assert.equal(matches,actual,`${rate}/${low}/${high}/${k}`);}
  }
});
test('missing rates, source absence and overflow remain distinct and unquotable',()=>{
  assert.deepEqual(projectUsdPrice({kind:'on_request',money:null,includes:[]},null),{status:'on_request',money:null,conversion:null});
  assert.equal(projectUsdPrice(price('1','EUR'),quote()).status,'unavailable');assert.equal(usdSourceRange('EUR',quote()),null);
  const overflow=projectUsdPrice(price('99999999999999.99'),quote('0.1'));assert.deepEqual(overflow,{status:'unavailable',money:null,conversion:null,reason:'amount_out_of_range'});
  assert.deepEqual(usdSourceRanges(null),[{currency:'USD',minimum:'0.00',maximum:'99999999999999.99'}]);
});
