import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { InjectOptions } from 'fastify';
import { makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { VehicleTranslationBundleResponseSchema, TranslationPlanResponseSchema, TranslationPlanResultResponseSchema,
  TranslationPlanStatusResponseSchema, type VehicleTranslationBundle, type TranslationPlanResult, type SaveVehicleTranslationBundle } from '@hd/contracts/admin';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createStaff } from '../src/staff-cli.js';
import { VehicleTranslator } from '../src/vehicles/translation.js';

async function transport(url: URL) {
  const socket=process.env.API_TEST_DATABASE_SOCKET;
  if(!socket)return url.toString();
  if(!path.isAbsolute(socket)||!(await stat(path.join(socket,`.s.PGSQL.${url.port||'5432'}`))).isSocket())throw new Error('Expected a local PostgreSQL socket directory.');
  const result=new URL(url);result.searchParams.set('host',socket);return result.toString();
}
test('UX11 workspace persists configuration and atomically adopts confirmed plan suggestions',async t=>{
  const base=new URL(process.env.API_TEST_DATABASE_URL??'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
  if(base.hostname!=='127.0.0.1'||base.pathname!=='/postgres'||base.search||base.hash)throw new Error('Use the local maintenance database, never an existing business database.');
  const name=`hd_ux11_workspace_${randomBytes(8).toString('hex')}`,url=new URL(base);url.pathname=`/${name}`;
  const maintenance=createDatabase(await transport(base),2),mediaRoot=await mkdtemp(path.join(tmpdir(),'hd-ux11-workspace-'));
  const network=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Real network is forbidden.');});
  let runtime:Awaited<ReturnType<typeof buildApp>>|undefined,created=false,calls=0,counter=0;
  const origin='http://127.0.0.1:3318';
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;
    const config=readConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),AUTH_BASE_URL:origin,
      TRUSTED_ORIGINS:origin,MEDIA_ROOT:mediaRoot,TRANSLATION_PROVIDER:'disabled'});
    const translator=new VehicleTranslator({engineVersion:'synthetic-ux11:1',async translate(text,target){calls++;return `${target==='en'?'Translated':'Перевод'} ${text}`;}},50000);
    const app=runtime=await buildApp({...config,databaseUrl:await transport(url)},{translator});await migrateDatabase(app.db);
    const call=(options:InjectOptions)=>app.app.inject({...options,remoteAddress:`198.51.${Math.floor(counter/240)}.${++counter%240+1}`});
    async function login(label:string){const email=`${label}@example.invalid`,password='Synthetic_workspace_password_1!';await createStaff(app.auth,{email,password,name:label,role:'editor'});
      const response=await call({method:'POST',url:'/api/auth/sign-in/email',headers:{origin},payload:{email,password}});assert.equal(response.statusCode,200,response.body);
      return response.cookies.map(cookie=>`${cookie.name}=${cookie.value}`).join('; ');}
    const cookie=await login('first'),other=await login('second'),headers={origin,cookie};
    const draft=makeVehicleDraftFixture();draft.media=[];draft.configuration={version:1,items:[{name:'排量(cc)',value:'1989'},{name:'座椅',value:'真皮'}]};
    draft.internal.notes='PRIVATE_UX11_SENTINEL';
    for(const field of Object.values(draft.content)){field.sourceLanguage='zh';field.translations.en=null;field.translations.ru=null;}
    const creation=await call({method:'POST',url:'/api/v1/admin/vehicles',headers:{...headers,'idempotency-key':randomUUID()},payload:{draft}});
    assert.equal(creation.statusCode,201,creation.body);const id=creation.json().data.id,route=`/api/v1/admin/vehicles/${id}`;
    const getBundle=async()=>{const response=await call({method:'GET',url:`${route}/translation-bundle`,headers});assert.equal(response.statusCode,200,response.body);return VehicleTranslationBundleResponseSchema.parse(response.json()).data;};
    const saveInput=(bundle:VehicleTranslationBundle):SaveVehicleTranslationBundle=>({version:bundle.vehicle.version,localizationRevision:bundle.localization.revision,
      content:bundle.vehicle.draft.content,localization:bundle.localization.data,sourceLanguageConfirmations:[]});
    await t.test('invalid pasted JSON cannot mutate a stored draft; omissions preserve and null clears',async()=>{
      let bundle=await getBundle();const before=bundle.vehicle.version;
      const bad=await call({method:'PATCH',url:route,headers,payload:{version:before,draft:{...bundle.vehicle.draft,configuration:'{"version":1,"version":1,"items":[]}'}}});
      assert.equal(bad.statusCode,400,bad.body);assert.equal((await getBundle()).vehicle.version,before);
      const {configuration:ignored,...old}=bundle.vehicle.draft;
      const saved=await call({method:'PATCH',url:route,headers,payload:{version:before,draft:old}});assert.equal(saved.statusCode,200,saved.body);
      assert.deepEqual(saved.json().data.draft.configuration,draft.configuration);
      bundle=await getBundle();const cleared=await call({method:'PATCH',url:route,headers,payload:{version:bundle.vehicle.version,draft:{...bundle.vehicle.draft,configuration:null}}});
      assert.equal(cleared.statusCode,200,cleared.body);assert.equal(cleared.json().data.draft.configuration,null);
      const missing=await call({method:'GET',url:`${route}/publish-readiness`,headers});assert.ok(missing.json().data.issues.some((item:{path:string})=>item.path==='draft.configuration'));
      const restored=await call({method:'PATCH',url:route,headers,payload:{version:cleared.json().data.version,draft:{...cleared.json().data.draft,configuration:draft.configuration}}});assert.equal(restored.statusCode,200,restored.body);
    });
    let suggestions:TranslationPlanResult;
    await t.test('plans are private, free to estimate and explicit to execute with durable replay',async()=>{
      const bundle=await getBundle();assert.deepEqual(bundle.sourceLanguageConfirmationRequired,[]);
      const estimate=await call({method:'POST',url:`${route}/translation-plans`,headers,payload:{version:bundle.vehicle.version}});assert.equal(estimate.statusCode,200,estimate.body);
      const plan=TranslationPlanResponseSchema.parse(estimate.json()).data;assert.equal(calls,0);assert.doesNotMatch(JSON.stringify(plan),/PRIVATE_UX11_SENTINEL|purchaseCost|supplierContact/);
      assert.equal(plan.estimate.cost.amount,null);assert.equal(plan.estimate.cost.freeAllowanceCharacters,null);
      const confirmation={confirmed:true,sourceFingerprint:plan.sourceFingerprint,maximumCharacters:plan.estimate.maximumCharacters,acceptUnknownCost:true},key=randomUUID();
      const forbidden=await call({method:'GET',url:`${route}/translation-plans/${plan.id}`,headers:{origin,cookie:other}});assert.equal(forbidden.statusCode,404);
      const unconfirmed=await call({method:'POST',url:`${route}/translation-plans/${plan.id}/generate`,headers:{...headers,'idempotency-key':key},payload:{...confirmation,confirmed:false}});assert.equal(unconfirmed.statusCode,400);assert.equal(calls,0);
      const generated=await call({method:'POST',url:`${route}/translation-plans/${plan.id}/generate`,headers:{...headers,'idempotency-key':key},payload:confirmation});assert.equal(generated.statusCode,200,generated.body);
      suggestions=TranslationPlanResultResponseSchema.parse(generated.json()).data;assert.equal(suggestions.status,'completed',generated.body);const used=calls;assert.ok(used>0);
      const replay=await call({method:'POST',url:`${route}/translation-plans/${plan.id}/generate`,headers:{...headers,'idempotency-key':key},payload:confirmation});assert.equal(replay.statusCode,200,replay.body);assert.equal(calls,used);
      const status=await call({method:'GET',url:`${route}/translation-plans/${plan.id}`,headers});assert.equal(TranslationPlanStatusResponseSchema.parse(status.json()).data.state,'completed');assert.equal(calls,used);
      assert.equal((await getBundle()).vehicle.version,bundle.vehicle.version);
      const legacy=await call({method:'POST',url:`${route}/translation-suggestions`,headers:{...headers,'idempotency-key':randomUUID()},payload:{version:bundle.vehicle.version}});
      assert.equal(legacy.statusCode,422,legacy.body);assert.equal(legacy.json().error.code,'TRANSLATION_CONFIRMATION_REQUIRED');assert.equal(calls,used);
    });
    await t.test('one bundle transaction saves current machine pending without altering original text',async()=>{
      let bundle=await getBundle();const input=saveInput(bundle),title=bundle.vehicle.draft.content.title.sourceText;
      for(const item of suggestions.fields){if(item.ref.startsWith('content.'))input.content[item.ref.slice(8) as 'title'|'description'].translations=item.translations;
        else input.localization.fields.find(field=>field.ref===item.ref)!.translations=item.translations;}
      const invalid=structuredClone(input);invalid.localization.fields[0]!.sourceHash='0'.repeat(64);
      const failed=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:invalid});assert.equal(failed.statusCode,409,failed.body);
      assert.equal((await getBundle()).vehicle.version,bundle.vehicle.version);assert.equal((await getBundle()).vehicle.draft.content.title.translations.en,null);
      const stored=async()=>({draft:(await app.db.pool.query('SELECT * FROM vehicle_drafts WHERE vehicle_id=$1',[id])).rows[0],
        localization:(await app.db.pool.query('SELECT * FROM vehicle_localizations WHERE vehicle_id=$1',[id])).rows[0],
        vehicle:(await app.db.pool.query('SELECT * FROM vehicles WHERE id=$1',[id])).rows[0]});
      const before=await stored();
      await app.db.pool.query("CREATE FUNCTION ux11_fail_bundle_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='vehicle.translationBundle.save' THEN RAISE EXCEPTION 'synthetic bundle rollback'; END IF; RETURN NEW; END $$");
      await app.db.pool.query('CREATE TRIGGER ux11_bundle_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ux11_fail_bundle_audit()');
      try {
        const interrupted=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:input});assert.equal(interrupted.statusCode,500);
        assert.deepEqual(await stored(),before,'all draft, localization and version writes must roll back after a final audit failure');
      } finally {await app.db.pool.query('DROP TRIGGER ux11_bundle_failure ON audit_events');await app.db.pool.query('DROP FUNCTION ux11_fail_bundle_audit()');}
      const saved=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:input});assert.equal(saved.statusCode,200,saved.body);
      bundle=VehicleTranslationBundleResponseSchema.parse(saved.json()).data;assert.equal(bundle.vehicle.version,input.version+1);assert.equal(bundle.localization.revision,input.localizationRevision+1);
      assert.equal(bundle.vehicle.draft.content.title.sourceText,title);assert.equal(bundle.vehicle.draft.content.title.translations.en?.kind,'machine');assert.equal(bundle.vehicle.draft.content.title.translations.en?.reviewStatus,'pending');
      const readiness=await call({method:'GET',url:`${route}/publish-readiness`,headers});assert.equal(readiness.json().data.localizationReady,true,readiness.body);
      const stale=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:input});assert.equal(stale.statusCode,409,stale.body);
    });
    await t.test('source changes invalidate unexecuted estimates before any paid work',async()=>{
      const bundle=await getBundle(),estimate=await call({method:'POST',url:`${route}/translation-plans`,headers,payload:{version:bundle.vehicle.version}});
      assert.equal(estimate.statusCode,200,estimate.body);const plan=estimate.json().data,before=calls;
      const draft=structuredClone(bundle.vehicle.draft);draft.content.title.sourceText='新的中文标题';
      const changed=await call({method:'PATCH',url:route,headers,payload:{version:bundle.vehicle.version,draft}});assert.equal(changed.statusCode,200,changed.body);
      const generated=await call({method:'POST',url:`${route}/translation-plans/${plan.id}/generate`,headers:{...headers,'idempotency-key':randomUUID()},payload:{confirmed:true,sourceFingerprint:plan.sourceFingerprint,maximumCharacters:plan.estimate.maximumCharacters,acceptUnknownCost:true}});
      assert.equal(generated.statusCode,409,generated.body);assert.equal(calls,before);
      const current=await getBundle();assert.equal(current.vehicle.draft.content.title.translations.zh?.text,'新的中文标题');assert.equal(current.vehicle.draft.content.title.translations.en?.reviewStatus,'stale');
    });
    await t.test('persisted segments recover after a process interruption without GET writes or provider retries',async()=>{
      const receipt=(await app.db.pool.query("SELECT * FROM translation_plans WHERE vehicle_id=$1 AND state='finished' ORDER BY created_at LIMIT 1",[id])).rows[0];
      assert.ok(receipt);const used=calls,planRoute=`${route}/translation-plans/${receipt.id}`;
      const confirmation={confirmed:true,sourceFingerprint:receipt.plan.sourceFingerprint,maximumCharacters:receipt.plan.estimate.maximumCharacters,acceptUnknownCost:true};
      // Only this random test database is rewound to the valid persisted state just before finalization.
      const interrupt=()=>app.db.pool.query("WITH timing AS (SELECT clock_timestamp() AS at) UPDATE translation_plans SET state='running',result=NULL,finished_at=NULL,started_at=timing.at-interval '160 seconds',lease_until=timing.at-interval '10 seconds' FROM timing WHERE id=$1",[receipt.id]);
      const stored=async()=>({plan:(await app.db.pool.query('SELECT * FROM translation_plans WHERE id=$1',[receipt.id])).rows[0],
        segments:(await app.db.pool.query('SELECT * FROM translation_plan_segments WHERE plan_id=$1 ORDER BY field_ref,target_locale,segment_index',[receipt.id])).rows});
      await interrupt();let before=await stored();
      const completed=await call({method:'GET',url:planRoute,headers});assert.equal(completed.statusCode,200,completed.body);
      const completedStatus=TranslationPlanStatusResponseSchema.parse(completed.json()).data;
      assert.equal(completedStatus.state,'completed');assert.equal(completedStatus.finishedAt,null);assert.deepEqual(await stored(),before);
      const replay=await call({method:'POST',url:`${planRoute}/generate`,headers:{...headers,'idempotency-key':receipt.generation_key},payload:confirmation});
      assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json().data,receipt.result);assert.equal(calls,used);
      await interrupt();
      const segment=before.segments[0]!;
      await app.db.pool.query("UPDATE translation_plan_segments SET state='running',translated_text=NULL,failure_code=NULL WHERE plan_id=$1 AND field_ref=$2 AND target_locale=$3 AND segment_index=$4",[receipt.id,segment.field_ref,segment.target_locale,segment.segment_index]);
      before=await stored();const partial=await call({method:'GET',url:planRoute,headers});assert.equal(partial.statusCode,200,partial.body);
      const partialStatus=TranslationPlanStatusResponseSchema.parse(partial.json()).data;
      assert.equal(partialStatus.state,'partial');assert.equal(partialStatus.finishedAt,null);
      assert.ok(partialStatus.result?.failures.some(failure=>failure.ref===segment.field_ref&&failure.targetLocale===segment.target_locale&&failure.code==='outcome_unknown'));
      assert.deepEqual(await stored(),before);
      const recovered=await call({method:'POST',url:`${planRoute}/generate`,headers:{...headers,'idempotency-key':receipt.generation_key},payload:confirmation});
      assert.equal(recovered.statusCode,200,recovered.body);assert.equal(recovered.json().data.status,'partial');assert.equal(calls,used);
      assert.equal((await stored()).segments.find(item=>item.field_ref===segment.field_ref&&item.target_locale===segment.target_locale)!.state,'outcome_unknown');
    });
    await t.test('legacy sources require explicit bundle confirmation and Chinese text always derives from its source',async()=>{
      const original=await getBundle(),legacy=structuredClone(original.vehicle.draft);
      legacy.content.title.sourceLanguage='und';
      legacy.content.title.translations.zh={...legacy.content.title.translations.zh!,text:'历史独立中文槽位',kind:'human',reviewStatus:'approved'};
      // Model a pre-sidecar record in this isolated database, without changing any runtime inventory.
      await app.db.pool.query('UPDATE vehicle_drafts SET data=$2 WHERE vehicle_id=$1',[id,JSON.stringify(legacy)]);
      await app.db.pool.query('DELETE FROM vehicle_localizations WHERE vehicle_id=$1',[id]);
      let bundle=await getBundle();assert.ok(bundle.sourceLanguageConfirmationRequired.includes('content.title'));
      assert.ok(bundle.sourceLanguageConfirmationRequired.includes('model'));
      const bypass=structuredClone(bundle.vehicle.draft);bypass.content.title.sourceLanguage='zh';
      const oldSave=await call({method:'PATCH',url:route,headers,payload:{version:bundle.vehicle.version,draft:bypass}});assert.equal(oldSave.statusCode,409,oldSave.body);
      const display=structuredClone(bundle.localization.data);display.fields.find(field=>field.ref==='model')!.sourceLanguage='zh';
      const oldDisplay=await call({method:'PUT',url:`${route}/localization`,headers,payload:{vehicleVersion:bundle.vehicle.version,revision:bundle.localization.revision,data:display}});assert.equal(oldDisplay.statusCode,409,oldDisplay.body);
      const notes=structuredClone(bundle.vehicle.draft);notes.internal.notes='Private legacy edit';
      const savedNotes=await call({method:'PATCH',url:route,headers,payload:{version:bundle.vehicle.version,draft:notes}});assert.equal(savedNotes.statusCode,200,savedNotes.body);
      bundle=await getBundle();assert.ok(bundle.sourceLanguageConfirmationRequired.includes('model'),'saving notes cannot silently confirm historical display sources');
      const used=calls,blocked=await call({method:'POST',url:`${route}/translation-plans`,headers,payload:{version:bundle.vehicle.version}});assert.equal(blocked.statusCode,422,blocked.body);assert.equal(calls,used);
      const input=saveInput(bundle);input.sourceLanguageConfirmations=bundle.sourceLanguageConfirmationRequired;
      const confirmed=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:input});assert.equal(confirmed.statusCode,200,confirmed.body);
      bundle=VehicleTranslationBundleResponseSchema.parse(confirmed.json()).data;assert.deepEqual(bundle.sourceLanguageConfirmationRequired,[]);
      assert.equal(bundle.vehicle.draft.content.title.translations.zh?.text,bundle.vehicle.draft.content.title.sourceText);
      assert.equal(bundle.vehicle.draft.content.title.translations.zh?.kind,'original');assert.equal(bundle.vehicle.draft.content.title.translations.zh?.reviewStatus,'pending');
      const mismatched=structuredClone(bundle.vehicle.draft);mismatched.content.title.translations.zh={...mismatched.content.title.translations.zh!,text:'另一历史人改中文',kind:'human',reviewStatus:'approved'};
      await app.db.pool.query('UPDATE vehicle_drafts SET data=$2 WHERE vehicle_id=$1',[id,JSON.stringify(mismatched)]);
      const readiness=await call({method:'GET',url:`${route}/publish-readiness`,headers});
      assert.ok(readiness.json().data.issues.some((issue:{path:string})=>issue.path==='draft.content.title.translations.zh'));
      bundle=await getBundle();const repaired=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:saveInput(bundle)});assert.equal(repaired.statusCode,200,repaired.body);
      const text=repaired.json().data.vehicle.draft.content.title;assert.equal(text.translations.zh.text,text.sourceText);assert.equal(text.translations.zh.reviewStatus,'pending');
    });
    await t.test('readiness requires both new migrations even when the external catalog is disabled',async()=>{
      assert.equal((await call({method:'GET',url:'/health/ready'})).statusCode,200);
      for(const table of ['translation_plan_segments','external_inspection_enrichment']) {
        await app.db.pool.query(`ALTER TABLE ${table} RENAME TO ux11_missing_table`);
        try {assert.equal((await call({method:'GET',url:'/health/ready'})).statusCode,503);}
        finally {await app.db.pool.query(`ALTER TABLE ux11_missing_table RENAME TO ${table}`);}
      }
      assert.equal((await call({method:'GET',url:'/health/ready'})).statusCode,200);
    });
    assert.equal(network.mock.callCount(),0);
  } finally {try {if(runtime)await runtime.app.close();} finally {try {if(created)await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);} finally {await maintenance.close();await rm(mediaRoot,{recursive:true,force:true});}}}
});
