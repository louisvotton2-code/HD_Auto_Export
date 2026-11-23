import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';

test('committed staff hides rotate the browse generation without changing ordinary sync semantics', async t => {
  const base=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if(!['postgres:','postgresql:'].includes(base.protocol)||base.hostname!=='127.0.0.1'||base.pathname!=='/postgres'||base.search||base.hash)
    throw new Error('Only the isolated loopback maintenance database is allowed.');
  const database=`hd_browse_generation_${randomBytes(8).toString('hex')}`;
  const maintenance=createDatabase(base.href,1);
  const address=new URL(base);
  address.pathname=`/${database}`;
  const db=createDatabase(address.href,3);
  let created=false;
  t.after(async()=>{
    await db.close();
    try {if(created) await maintenance.pool.query(`DROP DATABASE "${database}" WITH (FORCE)`);}
    finally {await maintenance.close();}
  });
  await maintenance.pool.query(`CREATE DATABASE "${database}"`);
  created=true;
  await migrateDatabase(db);

  type State={epoch:string;generation:string;revision:string;filterRevision:string};
  const stateSql=`SELECT epoch::text AS epoch,browse_generation::text AS generation,
    revision::text AS revision,filter_revision::text AS "filterRevision" FROM public_catalog_state WHERE id=1`;
  const state=async()=> (await db.pool.query<State>(stateSql)).rows[0]!;
  const bumped=(before:string,after:string)=>assert.equal(BigInt(after),BigInt(before)+1n);
  const staff='browse-generation-fixture', first=randomUUID(), second=randomUUID(), supplier=randomUUID();
  await db.transaction(async tx=>{
    await tx.query('INSERT INTO staff(id,name,email) VALUES($1,$1,$2)',[staff,'browse-generation@example.invalid']);
    for(const id of [first,second]) {
      const publication=randomUUID();
      await tx.query('INSERT INTO vehicles(id) VALUES($1)',[id]);
      await tx.query("INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,'{}')",[publication,id]);
      await tx.query(`UPDATE vehicles SET publication_state='published',published_revision_id=$2,published_at=now(),
        availability='available',availability_checked_at=now() WHERE id=$1`,[id,publication]);
    }
    await tx.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,
      source_data,upstream_state,fetched_at,published_at)
      VALUES ($1,'browse-fixture','che168','synthetic',1,$2,'{}','active',now(),now())`,[supplier,'a'.repeat(64)]);
    await tx.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
      VALUES ($1,now(),'Synthetic platform','https://example.invalid/synthetic','{}',10000,'[]',
        '{"zh":{"title":{"text":"合成测试车"}}}','{}')`,[supplier]);
  });

  const initial=await state();
  assert.equal(initial.generation,'1');
  await db.pool.query('UPDATE external_catalog SET price_cny=11000 WHERE listing_id=$1',[supplier]);
  const priced=await state();
  bumped(initial.revision,priced.revision);
  assert.equal(priced.generation,initial.generation);

  await db.pool.query("UPDATE external_listings SET upstream_state='withdrawn' WHERE id=$1",[supplier]);
  const withdrawn=await state();
  bumped(priced.revision,withdrawn.revision);
  assert.equal(withdrawn.generation,initial.generation);
  await db.pool.query("UPDATE external_listings SET upstream_state='active' WHERE id=$1",[supplier]);
  await db.pool.query("UPDATE vehicles SET availability='sold' WHERE id=$1",[second]);
  assert.equal((await state()).generation,initial.generation);

  const beforeRollback=await state();
  await assert.rejects(db.transaction(async tx=>{
    await tx.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[first]);
    assert.equal((await tx.query<State>(stateSql)).rows[0]!.generation,beforeRollback.generation);
    assert.deepEqual(await state(),beforeRollback);
    throw new Error('rollback fixture');
  }),/rollback fixture/);
  assert.deepEqual(await state(),beforeRollback);

  await db.transaction(async tx=>{
    await tx.query('SELECT queue_public_catalog_metadata_change()');
    await tx.query("UPDATE vehicles SET publication_state='archived' WHERE id=$1",[first]);
    await tx.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[second,staff]);
    await tx.query('INSERT INTO external_listing_overrides(listing_id,data) VALUES($1,$2)',[supplier,{hidden:true}]);
    assert.equal((await tx.query<State>(stateSql)).rows[0]!.generation,beforeRollback.generation);
  });
  const hidden=await state();
  bumped(beforeRollback.revision,hidden.revision);
  bumped(beforeRollback.filterRevision,hidden.filterRevision);
  bumped(beforeRollback.generation,hidden.generation);

  // Updating an already hidden override or re-publishing is a normal change.
  await db.pool.query('UPDATE external_listing_overrides SET data=data||$2::jsonb WHERE listing_id=$1',[supplier,{notes:'fixture'}]);
  await db.pool.query('UPDATE external_listing_overrides SET data=$2 WHERE listing_id=$1',[supplier,{hidden:false}]);
  assert.equal((await state()).generation,hidden.generation);
  await db.pool.query('UPDATE external_listing_overrides SET data=$2 WHERE listing_id=$1',[supplier,{hidden:true}]);
  const rehidden=await state();
  bumped(hidden.generation,rehidden.generation);

  await db.pool.query('SELECT queue_public_browse_invalidation()');
  const emergency=await state();
  bumped(rehidden.generation,emergency.generation);
  await db.pool.query('UPDATE public_catalog_state SET epoch=gen_random_uuid() WHERE id=1');
  const restored=await state();
  assert.notEqual(restored.epoch,emergency.epoch);
  assert.equal(restored.generation,emergency.generation);
});
