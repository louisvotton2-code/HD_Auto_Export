import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {PublicVehicleQuerySchema,PublicFilterQuerySchema,type Currency} from '@hd/contracts/public';
import {makeVehicleDraftFixture,makePublicVehicleFixture,makeExternalCandidateFixture} from '@hd/contracts/fixtures';
import {createDatabase} from '../src/db/index.js';
import {migrateDatabase} from '../src/db/migrate.js';
import {InventoryService} from '../src/vehicles/service.js';
import {buildProjection,emptyOverrides} from '../src/external/normalize.js';
import {seedSyntheticFx} from '../src/external/fx.js';
import {staffUsdCondition} from '../src/vehicles/usd-price.js';
const maintenanceUrl=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if(maintenanceUrl.hostname!=='127.0.0.1'||maintenanceUrl.pathname!=='/postgres'||maintenanceUrl.search||maintenanceUrl.hash)throw new Error('USD tests require local maintenance PostgreSQL.');
const name='hd_ext_scale_usd_prices_'+randomBytes(6).toString('hex'),url=new URL(maintenanceUrl);url.pathname='/'+name;
const maintenance=createDatabase(maintenanceUrl.toString(),1),db=createDatabase(url.toString(),3),inventory=new InventoryService(db,true);
let created=false;const staff:string[]=[],external:string[]=[];let unpricedCurrency:Currency;
const query=(extra:Record<string,unknown>={})=>PublicVehicleQuerySchema.parse({locale:'en',view:'localized',priceView:'usd',pageSize:48,...extra});
const filter=(extra:Record<string,unknown>={})=>PublicFilterQuerySchema.parse({locale:'en',view:'localized',priceView:'usd',...extra});
before(async()=>{
 await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;await migrateDatabase(db);
 await seedSyntheticFx(db,'b');
 unpricedCurrency='KGS';await db.pool.query("UPDATE public_fx_quote SET rates=rates-'KGS' WHERE id=1");
 for(const [currency,amount] of [['USD','1.01'],['CNY','8.04'],['EUR','99999999999999.99'],[unpricedCurrency,'1.00']] as const){
  const id=randomUUID(),publication=randomUUID(),draft=makeVehicleDraftFixture();staff.push(id);draft.price={kind:'asking',money:{currency,amount},includes:[]};
  const snapshot={source:draft.source,facts:draft.facts,price:draft.price,content:draft.content,images:makePublicVehicleFixture().images};
  await db.transaction(async tx=>{
   await tx.query("INSERT INTO vehicles(id,availability,availability_checked_at) VALUES($1,'available',now())",[id]);
   await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)',[id,JSON.stringify(draft)]);
   await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publication,id,JSON.stringify(snapshot)]);
   await tx.query("UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now() WHERE id=$1",[id,publication]);
  });
 }
 for(const [index,amount] of ['7.99','8.00','8.03','8.04','8.11','8.12',null].entries()){
  const id=randomUUID(),candidate=makeExternalCandidateFixture(index+20);external.push('ext-'+id);candidate.images=[];candidate.price=amount===null?null:{cny:amount};
  const p=buildProjection(candidate,emptyOverrides(),'Synthetic Market');
  await db.transaction(async tx=>{
   await tx.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,published_at)
    VALUES($1,'synthetic-feed','synthetic-market',$2,1,$3,$4,'active',now(),now())`,[id,'usd-'+index,'a'.repeat(64),JSON.stringify(candidate)]);
   await tx.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
    VALUES($1,now(),'Synthetic Market',$2,$3,$4,$5,$6,$7)`,[id,candidate.listingUrl,JSON.stringify(p.facts),p.priceCny,JSON.stringify(p.issues),JSON.stringify(p.localized),JSON.stringify(p.details)]);
  });
 }
 await db.pool.query('UPDATE home_config SET sections=$1 WHERE id=1',[JSON.stringify([{id:'featured',title:{zh:'测试',en:'Test',ru:'Тест'},vehicleIds:staff.slice(0,2)}])]);
});
after(async()=>{await db.close();if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);await maintenance.close();});

test('list/detail/home expose one USD projection while legacy and original money remain intact',async()=>{
 const list=await inventory.listPublic(query(),'usd');assert.equal(list.meta.total,11);
 const byId=new Map(list.data.items.map(item=>[item.id,item]));
 const native=byId.get(staff[0]!)!,converted=byId.get(staff[1]!)!;
 assert.deepEqual(native.displayPrice,{status:'ready',kind:'asking',money:{amount:'1.01',currency:'USD'},conversion:null});
 assert.equal(converted.price.money?.amount,'8.04');assert.equal(converted.price.money?.currency,'CNY');
 assert.equal(converted.displayPrice?.status,'ready');if(converted.displayPrice?.status==='ready'){assert.equal(converted.displayPrice.kind,'reference');assert.equal(converted.displayPrice.money.amount,'1.01');assert.equal(converted.displayPrice.conversion?.source,'synthetic');}
 for(const id of [staff[0]!,staff[1]!,external[3]!])assert.deepEqual((await inventory.getPublic(id,'en','localized','usd')).displayPrice,byId.get(id)!.displayPrice);
 const home=await inventory.publicHome('en','localized','usd');for(const item of home.sections[0]!.vehicles)assert.deepEqual(item.displayPrice,byId.get(item.id)!.displayPrice);
 for(const item of list.data.items)assert.doesNotMatch(JSON.stringify(item.displayPrice),/"(?:rates|rate|base|quote|version|expiresAt)"/);
 assert.equal(byId.get(external[6]!)!.displayPrice?.status,'on_request');
 assert.deepEqual(byId.get(staff[2]!)!.displayPrice,{status:'unavailable',money:null,conversion:null,reason:'amount_out_of_range'});
 assert.deepEqual(byId.get(staff[3]!)!.displayPrice,{status:'unavailable',money:null,conversion:null,reason:'rate_unavailable'});
 const old=await inventory.listPublic(PublicVehicleQuerySchema.parse({locale:'en',view:'localized',pageSize:48}),'old');
 assert.ok(old.data.items.every(item=>!Object.hasOwn(item,'displayPrice')));
 assert.equal(Object.hasOwn(await inventory.getPublic(staff[0]!,'en','localized'),'displayPrice'),false);
 assert.ok((await inventory.publicHome('en','localized')).sections[0]!.vehicles.every(item=>!Object.hasOwn(item,'displayPrice')));
});

test('rounded USD boundaries, native USD and facets use exactly the same filtered population',async()=>{
 const range={priceMin:'1.01',priceMax:'1.01',priceCurrency:'USD'};
 const list=await inventory.listPublic(query(range),'range');assert.equal(list.meta.total,4);
 assert.deepEqual(new Set(list.data.items.map(item=>item.id)),new Set([staff[0],staff[1],external[3],external[4]]));
 assert.ok(list.data.items.every(item=>item.displayPrice?.status==='ready'&&item.displayPrice.money.amount==='1.01'));
 assert.deepEqual((await inventory.filters(filter(range))).priceCurrencies,[{id:'USD',count:4}]);
 assert.deepEqual((await inventory.filters(filter())).priceCurrencies,[{id:'USD',count:8}]);
 assert.equal((await inventory.filters(filter())).total,11);
 const old=await inventory.listPublic(PublicVehicleQuerySchema.parse({locale:'en',view:'localized',...range}),'old-range');assert.equal(old.meta.total,1);assert.equal(old.data.items[0]!.id,staff[0]);
});

test('expiry leaves native USD usable and removes unavailable prices only from bounded results',async()=>{
 await seedSyntheticFx(db,'expired');
 const all=await inventory.listPublic(query(),'expired');assert.equal(all.meta.total,11);
 assert.equal(all.data.items.find(item=>item.id===staff[0])!.displayPrice?.status,'ready');
 assert.equal(all.data.items.find(item=>item.id===external[3])!.displayPrice?.status,'unavailable');
 assert.deepEqual((await inventory.filters(filter())).priceCurrencies,[{id:'USD',count:1}]);
 assert.equal((await inventory.listPublic(query({priceMin:'0',priceCurrency:'USD'}),'bounded-expired')).meta.total,1);
});

test('guarded publication price index is usable and source CNY bounds are plain numeric index conditions',async()=>{
 const {quote}=await seedSyntheticFx(db,'b');const params:unknown[]=[];const condition=staffUsdCondition(params,quote,'1.01','1.01');
 const plans=await db.transaction(async tx=>{
  await tx.query('SET LOCAL enable_seqscan=off');
  const staffPlan=(await tx.query(`EXPLAIN (FORMAT JSON) SELECT p.id FROM vehicle_publications p WHERE ${condition}`,params)).rows[0]['QUERY PLAN'];
  const externalPlan=(await tx.query('EXPLAIN (FORMAT JSON) SELECT listing_id FROM external_catalog WHERE price_cny >= $1::numeric AND price_cny <= $2::numeric',['8.04','8.11'])).rows[0]['QUERY PLAN'];
  return {staff:JSON.stringify(staffPlan),external:JSON.stringify(externalPlan)};
 });
 assert.match(plans.staff,/vehicle_publications_currency_amount_idx/);assert.match(plans.staff,/Index Cond/);
 assert.match(plans.external,/external_catalog_price_idx/);assert.match(plans.external,/Index Cond/);
});
