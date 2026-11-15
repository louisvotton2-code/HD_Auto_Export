import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { InjectOptions } from 'fastify';
import { makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { VehicleTranslationBundleResponseSchema, TranslationPlanResponseSchema, TranslationPlanResultResponseSchema,
  TranslationPlanStatusResponseSchema, RecoverableTranslationPlanResponseSchema, type VehicleTranslationBundle, type TranslationPlanResult, type SaveVehicleTranslationBundle } from '@hd/contracts/admin';
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
  let rejectedText: string | undefined;
  const providerCalls: Array<{ text: string; target: 'en' | 'ru' }> = [];
  let reservedCharacters = 0;
  const russianFactTranslations = new Map([
    ['直流快充电量范围', 'Диапазон заряда при быстрой зарядке постоянным током'],
    ['4向电动调节', 'Электрорегулировка в 4 направлениях'],
  ]);
  const origin='http://127.0.0.1:3318';
  try {
    await maintenance.pool.query(`CREATE DATABASE "${name}"`);created=true;
    const config=readConfig({NODE_ENV:'test',DATABASE_URL:url.toString(),AUTH_SECRET:randomBytes(32).toString('hex'),AUTH_BASE_URL:origin,
      TRUSTED_ORIGINS:origin,MEDIA_ROOT:mediaRoot,TRANSLATION_PROVIDER:'disabled'});
    const translator=new VehicleTranslator({engineVersion:'synthetic-ux11:1',async translate(text,target){
      calls++;
      providerCalls.push({text,target});
      if(text==='4向电动调节'&&target==='en')return '4-way power adjustment';
      if(text==='直流快充电量范围'&&target==='en')return 'State-of-charge range during DC fast charging';
      const russian = russianFactTranslations.get(text);
      if(target==='ru'&&russian)return russian;
      if (text === rejectedText && target === 'ru') return '  ';
      return `${target==='en'?'Translated':'Перевод'} ${text}`;
    }},50000,'libretranslate',{async reserve(characters){reservedCharacters+=characters;}});
    const app=runtime=await buildApp({...config,databaseUrl:await transport(url)},{translator});await migrateDatabase(app.db);
    const call=(options:InjectOptions)=>app.app.inject({...options,remoteAddress:`198.51.${Math.floor(counter/240)}.${++counter%240+1}`});
    async function login(label:string){const email=`${label}@example.invalid`,password='Synthetic_workspace_password_1!';await createStaff(app.auth,{email,password,name:label,role:'editor'});
      const response=await call({method:'POST',url:'/api/auth/sign-in/email',headers:{origin},payload:{email,password}});assert.equal(response.statusCode,200,response.body);
      return response.cookies.map(cookie=>`${cookie.name}=${cookie.value}`).join('; ');}
    const cookie=await login('first'),other=await login('second'),headers={origin,cookie};
    const draft=makeVehicleDraftFixture();draft.media=[];draft.facts.trim={id:'translation_trim',name:'Synthetic translation trim'};draft.configuration={version:1,items:[{name:'排量(cc)',value:'1989'},{name:'座椅',value:'真皮'}]};
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
      const recovery=await call({url:route+'/translation-plans/recoverable',headers});
      assert.equal(recovery.statusCode,200,recovery.body);
      assert.deepEqual(RecoverableTranslationPlanResponseSchema.parse(recovery.json()).data,{plan,result:suggestions});
      assert.equal(calls,used);
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
      const outOfScope=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:{...input,localization:{...input.localization,facts:{...input.localization.facts,mileageKm:0}}}});
      assert.equal(outOfScope.statusCode,400,outOfScope.body);assert.deepEqual(await stored(),before);
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
    await t.test('bundle facts and text save atomically while generation translations follow the returned source identity',async()=>{
      let bundle=await getBundle();assert.equal(bundle.localization.data.facts.generation,null);
      const input=saveInput(bundle);input.localization.facts={generation:{id:'generation_one',name:'第一代'},drivetrain:'awd'};
      input.content.title.translations.en={...input.content.title.translations.en!,text:'Human title edited with generation',kind:'human',reviewStatus:'pending',engineVersion:null};
      const stored=async()=>({draft:(await app.db.pool.query('SELECT * FROM vehicle_drafts WHERE vehicle_id=$1',[id])).rows[0],
        localization:(await app.db.pool.query('SELECT * FROM vehicle_localizations WHERE vehicle_id=$1',[id])).rows[0],
        vehicle:(await app.db.pool.query('SELECT * FROM vehicles WHERE id=$1',[id])).rows[0]});
      const before=await stored();
      const staleRevision=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:{...input,localizationRevision:input.localizationRevision-1}});
      assert.equal(staleRevision.statusCode,409,staleRevision.body);assert.deepEqual(await stored(),before);
      const forged=structuredClone(input);forged.localization.fields.push({...forged.localization.fields[0]!,ref:'generation',sourceText:'第一代'});
      const extra=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:forged});assert.equal(extra.statusCode,409,extra.body);assert.deepEqual(await stored(),before);
      const estimate=await call({method:'POST',url:`${route}/translation-plans`,headers,payload:{version:bundle.vehicle.version}});
      assert.equal(estimate.statusCode,200,estimate.body);const oldPlan=estimate.json().data,used=calls;
      await app.db.pool.query("CREATE FUNCTION ux11_fail_facts_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='vehicle.translationBundle.save' THEN RAISE EXCEPTION 'synthetic facts rollback'; END IF; RETURN NEW; END $$");
      await app.db.pool.query('CREATE TRIGGER ux11_facts_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ux11_fail_facts_audit()');
      try {
        const failed=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:input});assert.equal(failed.statusCode,500,failed.body);
        assert.deepEqual(await stored(),before);
      } finally {await app.db.pool.query('DROP TRIGGER ux11_facts_failure ON audit_events');await app.db.pool.query('DROP FUNCTION ux11_fail_facts_audit()');}
      const saved=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:input});assert.equal(saved.statusCode,200,saved.body);
      bundle=VehicleTranslationBundleResponseSchema.parse(saved.json()).data;
      assert.deepEqual(bundle.localization.data.facts,input.localization.facts);assert.equal(bundle.vehicle.version,input.version+1);assert.equal(bundle.localization.revision,input.localizationRevision+1);
      assert.equal(bundle.vehicle.draft.content.title.translations.en?.text,input.content.title.translations.en.text);
      assert.equal(bundle.vehicle.draft.content.title.sourceText,input.content.title.sourceText);
      let generation=bundle.localization.data.fields.find(field=>field.ref==='generation')!;
      assert.equal(generation.sourceText,'第一代');assert.equal(generation.sourceLanguage,'zh');assert.equal(generation.sourceVersion,1);
      assert.equal(generation.translations.zh?.text,'第一代');assert.equal(generation.translations.zh?.kind,'original');
      assert.equal(generation.translations.en,null);assert.equal(generation.translations.ru,null);
      const state=await call({method:'GET',url:`${route}/publish-readiness`,headers});assert.equal(state.json().data.localizationReady,false);
      assert.ok(state.json().data.issues.some((issue:{path:string})=>issue.path==='localization.generation.en'));
      const old=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:input});assert.equal(old.statusCode,409,old.body);
      const invalidPlan=await call({method:'POST',url:`${route}/translation-plans/${oldPlan.id}/generate`,headers:{...headers,'idempotency-key':randomUUID()},payload:{confirmed:true,sourceFingerprint:oldPlan.sourceFingerprint,maximumCharacters:oldPlan.estimate.maximumCharacters,acceptUnknownCost:true}});
      assert.equal(invalidPlan.statusCode,409,invalidPlan.body);assert.equal(calls,used);
      const nextPlan=await call({method:'POST',url:`${route}/translation-plans`,headers,payload:{version:bundle.vehicle.version}});assert.equal(nextPlan.statusCode,200,nextPlan.body);
      assert.ok(nextPlan.json().data.fields.some((field:{ref:string;sourceText:string})=>field.ref==='generation'&&field.sourceText==='第一代'));

      for(const locale of ['en','ru'] as const) generation.translations[locale]={text:locale==='en'?'First generation':'Первое поколение',kind:'human',reviewStatus:'pending',sourceVersion:generation.sourceVersion,humanEditVersion:0,engineVersion:null};
      const translated=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:saveInput(bundle)});assert.equal(translated.statusCode,200,translated.body);
      bundle=VehicleTranslationBundleResponseSchema.parse(translated.json()).data;generation=bundle.localization.data.fields.find(field=>field.ref==='generation')!;
      const currentGeneration=structuredClone(generation),drive=saveInput(bundle);drive.localization.facts.drivetrain='fwd';
      const driveSaved=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:drive});assert.equal(driveSaved.statusCode,200,driveSaved.body);
      bundle=VehicleTranslationBundleResponseSchema.parse(driveSaved.json()).data;assert.equal(bundle.localization.data.facts.drivetrain,'fwd');
      assert.deepEqual(bundle.localization.data.fields.find(field=>field.ref==='generation'),currentGeneration,'drivetrain alone must not retranslate generation');

      const renamed=saveInput(bundle);renamed.localization.facts.generation={id:'generation_two',name:'第二代'};
      const renamedSaved=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:renamed});assert.equal(renamedSaved.statusCode,200,renamedSaved.body);
      bundle=VehicleTranslationBundleResponseSchema.parse(renamedSaved.json()).data;generation=bundle.localization.data.fields.find(field=>field.ref==='generation')!;
      assert.equal(generation.sourceVersion,currentGeneration.sourceVersion+1);assert.notEqual(generation.sourceHash,currentGeneration.sourceHash);
      assert.equal(generation.translations.zh?.text,'第二代');assert.equal(generation.translations.en?.text,'First generation');assert.equal(generation.translations.en?.reviewStatus,'stale');
      assert.equal(generation.translations.ru?.text,'Первое поколение');assert.equal(generation.translations.ru?.reviewStatus,'stale');
      const removed=saveInput(bundle),retired=bundle.localization.retiredFieldCount;removed.localization.facts={generation:null,drivetrain:null};
      const removedSaved=await call({method:'PUT',url:`${route}/translation-bundle`,headers,payload:removed});assert.equal(removedSaved.statusCode,200,removedSaved.body);
      bundle=VehicleTranslationBundleResponseSchema.parse(removedSaved.json()).data;assert.deepEqual(bundle.localization.data.facts,{generation:null,drivetrain:null});
      assert.equal(bundle.localization.data.fields.some(field=>field.ref==='generation'),false);assert.equal(bundle.localization.retiredFieldCount,retired+1);assert.equal(calls,used);
      const contenders=(['fwd','rwd'] as const).map(drivetrain=>({...structuredClone(saveInput(bundle)),localization:{...structuredClone(bundle.localization.data),facts:{generation:null,drivetrain}}}));
      const raced=await Promise.all(contenders.map(payload=>call({method:'PUT',url:`${route}/translation-bundle`,headers,payload})));
      assert.deepEqual(raced.map(response=>response.statusCode).sort(),[200,409]);
      const winner=VehicleTranslationBundleResponseSchema.parse(raced.find(response=>response.statusCode===200)!.json()).data;
      assert.deepEqual((await getBundle()).localization.data.facts,winner.localization.data.facts);assert.equal(winner.vehicle.version,bundle.vehicle.version+1);
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
    await t.test('legacy source language never blocks planning or nonblank translations', async () => {
      const original = await getBundle(), legacy = structuredClone(original.vehicle.draft);
      legacy.content.title.sourceLanguage = 'und';
      legacy.content.title.translations.zh = { ...legacy.content.title.translations.zh!,
        text: '历史独立中文槽位', kind: 'human', reviewStatus: 'approved' };
      // Model a pre-sidecar record in this isolated database.
      await app.db.pool.query('UPDATE vehicle_drafts SET data=$2 WHERE vehicle_id=$1', [id, JSON.stringify(legacy)]);
      await app.db.pool.query('DELETE FROM vehicle_localizations WHERE vehicle_id=$1', [id]);
      let bundle = await getBundle();
      assert.deepEqual(bundle.sourceLanguageConfirmationRequired, []);
      assert.equal(bundle.vehicle.draft.content.title.sourceLanguage, 'und');
      assert.equal(bundle.localization.data.fields.find(field => field.ref === 'model')?.sourceLanguage, 'und');

      const display = structuredClone(bundle.localization.data);
      display.fields.find(field => field.ref === 'model')!.sourceLanguage = 'zh';
      const oldDisplay = await call({ method: 'PUT', url: route + '/localization', headers,
        payload: { vehicleVersion: bundle.vehicle.version, revision: bundle.localization.revision, data: display } });
      assert.equal(oldDisplay.statusCode, 409, oldDisplay.body);

      const readiness = await call({ url: route + '/publish-readiness', headers });
      assert.equal(readiness.statusCode, 200, readiness.body);
      assert.ok(!readiness.json().data.issues.some((issue: { path: string }) =>
        issue.path.endsWith('.sourceLanguage') || issue.path === 'draft.content.title.translations.zh'));
      const used = calls;
      const estimate = await call({ method: 'POST', url: route + '/translation-plans', headers,
        payload: { version: bundle.vehicle.version, scope: 'missing' } });
      assert.equal(estimate.statusCode, 200, estimate.body);
      assert.ok(TranslationPlanResponseSchema.parse(estimate.json()).data.fields.some(field => field.ref === 'model'));
      assert.equal(calls, used);

      const quote = async (version: number) => {
        const result = await call({ method: 'POST', url: route + '/translation-plans', headers, payload: { version } });
        assert.equal(result.statusCode, 200, result.body);
        return TranslationPlanResponseSchema.parse(result.json()).data;
      };
      const beforeQuote = await quote(bundle.vehicle.version);
      const originalTitle = bundle.vehicle.draft.content.title;
      const basics = structuredClone(bundle.vehicle.draft);
      basics.content.title.sourceLanguage = 'zh';
      basics.content.title.sourceText = '明确修改的中文标题';
      basics.content.description.sourceLanguage = 'zh';
      basics.content.description.sourceText = '明确修改的中文车况';
      const saveRequest = { version: bundle.vehicle.version, draft: basics };
      const saved = await call({ method: 'PATCH', url: route, headers, payload: saveRequest });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.equal((await call({method:'PATCH',url:route,headers,payload:saveRequest})).statusCode,409);
      bundle = await getBundle();
      const title = bundle.vehicle.draft.content.title;
      assert.equal(title.sourceLanguage, 'zh');
      assert.equal(title.sourceText, basics.content.title.sourceText);
      assert.equal(title.sourceVersion, originalTitle.sourceVersion + 1);
      for (const locale of ['zh','en','ru'] as const)
        assert.equal(title.translations[locale]?.text, originalTitle.translations[locale]?.text);
      const currentQuote = await quote(bundle.vehicle.version);
      assert.notEqual(currentQuote.fields.find(field=>field.ref==='content.title')?.sourceHash,
        beforeQuote.fields.find(field=>field.ref==='content.title')?.sourceHash);
      const stalePlan = await call({method:'POST',url:`${route}/translation-plans/${beforeQuote.id}/generate`,
        headers:{...headers,'idempotency-key':randomUUID()},payload:{confirmed:true,sourceFingerprint:beforeQuote.sourceFingerprint,
          maximumCharacters:beforeQuote.estimate.maximumCharacters,acceptUnknownCost:true}});
      assert.equal(stalePlan.statusCode,409,stalePlan.body);
      assert.equal(calls,used);
      const audit=(await app.db.pool.query(`SELECT changes FROM audit_events WHERE vehicle_id=$1 AND operation='vehicle.save'
        ORDER BY new_version DESC LIMIT 1`,[id])).rows[0]!.changes;
      assert.ok(audit.some((change:{path:string;after:unknown})=>change.path==='draft.content.title.sourceLanguage'&&change.after==='zh'));
      assert.ok(audit.some((change:{path:string;after:unknown})=>change.path==='draft.content.title.sourceText'&&change.after===basics.content.title.sourceText));

      const input = saveInput(bundle);
      input.sourceLanguageConfirmations = ['model'];
      const edited = await call({ method: 'PUT', url: route + '/translation-bundle', headers, payload: input });
      assert.equal(edited.statusCode, 200, edited.body);
      bundle = VehicleTranslationBundleResponseSchema.parse(edited.json()).data;
      assert.equal(bundle.vehicle.draft.content.title.sourceLanguage, 'zh');
      assert.equal(bundle.localization.data.fields.find(field => field.ref === 'model')?.sourceLanguage, 'zh');
      assert.deepEqual(bundle.sourceLanguageConfirmationRequired, []);
      assert.equal(bundle.vehicle.draft.content.title.translations.zh?.text, '历史独立中文槽位');
      assert.equal(bundle.vehicle.draft.content.title.translations.zh?.kind, 'human');
    });
    await t.test('missing scope only fills empty slots and partially used paid receipts survive source edits', async () => {
      const sample = structuredClone(draft);
      sample.facts.model = { id: 'missing_scope_model', name: '补译专用车型' };
      const seatLabel = '补译专用座椅', priorSeatText = '补译专用真皮', nextSeatText = '补译专用混合材质';
      sample.configuration = { version: 1, items: [{ name: '排量(cc)', value: '1989' }, { name: seatLabel, value: priorSeatText }] };
      const { title, description } = sample.content;
      title.sourceText = '补译专用测试车 120 kW';
      description.sourceText = '4向电动调节';
      const machine = (field: { sourceVersion: number }, text: string, reviewStatus: 'pending' | 'stale' = 'pending') =>
        ({ text, kind: 'machine' as const, reviewStatus, sourceVersion: field.sourceVersion, humanEditVersion: 0, engineVersion: 'fixture:previous' });
      const human = (field: { sourceVersion: number }, text: string, reviewStatus: 'approved' | 'stale') =>
        ({ ...machine(field, text), kind: 'human' as const, reviewStatus, engineVersion: null });
      title.translations.en = machine(title, 'Saved title 120 kW');
      description.translations.ru = human(description, 'Сохранено сотрудником', 'stale');
      const created = await call({ method: 'POST', url: '/api/v1/admin/vehicles',
        headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { draft: sample } });
      assert.equal(created.statusCode, 201, created.body);
      const vehicleUrl = '/api/v1/admin/vehicles/' + created.json().data.id;
      const bundleUrl = vehicleUrl + '/translation-bundle', planUrl = vehicleUrl + '/translation-plans';
      async function read() {
        const response = await call({ url: bundleUrl, headers });
        assert.equal(response.statusCode, 200, response.body);
        return VehicleTranslationBundleResponseSchema.parse(response.json()).data;
      }
      async function save(input: SaveVehicleTranslationBundle) {
        const response = await call({ method: 'PUT', url: bundleUrl, headers, payload: input });
        assert.equal(response.statusCode, 200, response.body);
        return VehicleTranslationBundleResponseSchema.parse(response.json()).data;
      }
      async function createPlan(version: number, scope?: 'missing') {
        const response = await call({ method: 'POST', url: planUrl, headers, payload: { version, scope } });
        assert.equal(response.statusCode, 200, response.body);
        return TranslationPlanResponseSchema.parse(response.json()).data;
      }
      async function recover() {
        const response = await call({ url: planUrl + '/recoverable', headers });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.headers['cache-control'], 'no-store');
        return RecoverableTranslationPlanResponseSchema.parse(response.json()).data;
      }
      const mapping = saveInput(await read());
      const seatName = mapping.localization.fields.find(field => field.sourceText === seatLabel)!.ref;
      const seatValue = mapping.localization.fields.find(field => field.sourceText === priorSeatText)!.ref;
      const configRef = mapping.localization.fields.find(field => field.sourceText === '排量(cc)')!.ref;
      for (const field of mapping.localization.fields) {
        if (field.ref === 'model') {
          field.translations.en = { ...machine(field, 'Old model', 'stale'), sourceVersion: field.sourceVersion + 1 };
        } else if (![seatName, seatValue].includes(field.ref)) {
          field.translations.en = human(field, 'Reviewed ' + field.sourceText, 'approved');
        }
        field.translations.ru = human(field, field.ref === configRef ? 'Рабочий объём (kW)' : 'Проверено ' + field.sourceText, 'approved');
      }
      let bundle = await save(mapping);
      const retained = structuredClone(bundle.localization.data.fields.find(field => field.ref === configRef)!);
      const retainedModel = structuredClone(bundle.localization.data.fields.find(field => field.ref === 'model')!);
      assert.equal(retained.translations.ru?.text, 'Рабочий объём (kW)');
      assert.equal(retainedModel.translations.en?.reviewStatus, 'stale');
      assert.notEqual(retainedModel.translations.en?.sourceVersion, retainedModel.sourceVersion);
      const exactTargets = (plan: Awaited<ReturnType<typeof createPlan>>) => plan.fields.map(field => [field.ref, field.targets]);
      const before = providerCalls.length, budgetBefore = reservedCharacters;
      const legacy = await createPlan(bundle.vehicle.version);
      assert.ok(legacy.fields.length > 4 && legacy.fields.every(field => field.targets === undefined));
      const denied = await call({ method: 'POST', url: planUrl, headers,
        payload: { version: bundle.vehicle.version, scope: 'missing', targets: ['en'], sourceText: 'forged' } });
      assert.equal(denied.statusCode, 400, denied.body);
      const plan = await createPlan(bundle.vehicle.version, 'missing');
      assert.deepEqual(exactTargets(plan), [['content.title', ['ru']], ['content.description', ['en']], [seatName, ['en']], [seatValue, ['en']]]);
      assert.notEqual(plan.sourceFingerprint, legacy.sourceFingerprint);
      assert.equal(plan.estimate.maximumRequests, 4);
      assert.equal(plan.estimate.maximumCharacters, plan.fields.reduce((sum, field) => sum + field.sourceText.length, 0));
      assert.equal(providerCalls.length, before);
      const request = (value: typeof plan, key = randomUUID()) => ({
        method: 'POST' as const, url: planUrl + '/' + value.id + '/generate', headers: { ...headers, 'idempotency-key': key },
        payload: { confirmed: true, sourceFingerprint: value.sourceFingerprint, maximumCharacters: value.estimate.maximumCharacters, acceptUnknownCost: true },
      });
      async function send(options: ReturnType<typeof request>) {
        const response = await call(options);
        assert.equal(response.statusCode, 200, response.body);
        return TranslationPlanResultResponseSchema.parse(response.json()).data;
      }
      function adopt(current: VehicleTranslationBundle, result: TranslationPlanResult, refs?: string[]) {
        const input = structuredClone(saveInput(current));
        for (const field of result.fields) {
          if (refs && !refs.includes(field.ref)) continue;
          const target = field.ref === 'content.title' ? input.content.title : field.ref === 'content.description' ? input.content.description :
            input.localization.fields.find(candidate => candidate.ref === field.ref)!;
          for (const locale of ['en', 'ru'] as const) {
            const suggestion = field.translations[locale];
            if (suggestion && !target.translations[locale]?.text.trim()) target.translations[locale] = suggestion;
          }
        }
        return input;
      }
      const generation = request(plan), titleText = title.sourceText!;
      rejectedText = titleText;
      let partial: TranslationPlanResult;
      try { partial = await send(generation); } finally { rejectedText = undefined; }
      assert.equal(partial.status, 'partial');
      assert.deepEqual(partial.failures, [{ ref: 'content.title', targetLocale: 'ru', code: 'invalid_result' }]);
      assert.deepEqual(providerCalls.slice(before), plan.fields.map(field => ({ text: field.sourceText, target: field.targets![0] })));
      assert.equal(reservedCharacters - budgetBefore, plan.estimate.maximumCharacters);
      assert.deepEqual(await send(generation), partial);
      const status = await call({ url: planUrl + '/' + plan.id, headers });
      assert.deepEqual(TranslationPlanStatusResponseSchema.parse(status.json()).data.result, partial);
      const storedPlan = async () => (await app.db.pool.query('SELECT * FROM translation_plans WHERE id=$1', [plan.id])).rows[0];
      const beforeRecovery = await storedPlan(), paidBeforeRecovery = providerCalls.length, reservedBeforeRecovery = reservedCharacters;
      const anonymous = await call({ url: planUrl + '/recoverable' });
      assert.equal(anonymous.statusCode, 401, anonymous.body);
      const otherStaff = await call({ url: planUrl + '/recoverable', headers: { origin, cookie: other } });
      assert.equal(otherStaff.statusCode, 200, otherStaff.body);
      assert.equal(RecoverableTranslationPlanResponseSchema.parse(otherStaff.json()).data, null);
      assert.doesNotMatch(otherStaff.body, new RegExp(plan.id));
      assert.deepEqual(await recover(), { plan, result: partial });

      const historical = structuredClone(partial);
      historical.fields.find(field => field.ref === 'content.description')!.translations.en!.text = '5-way power adjustment';
      await app.db.pool.query('UPDATE translation_plans SET result=$2 WHERE id=$1', [plan.id, JSON.stringify(historical)]);
      try {
        assert.deepEqual(await recover(), { plan, result: historical });
      } finally {
        await app.db.pool.query('UPDATE translation_plans SET result=$2 WHERE id=$1', [plan.id, JSON.stringify(partial)]);
      }
      const forgedHash = 'f'.repeat(64);
      await app.db.pool.query("UPDATE translation_plans SET plan=jsonb_set(plan,'{sourceFingerprint}',to_jsonb($2::text)),result=jsonb_set(result,'{sourceFingerprint}',to_jsonb($2::text)) WHERE id=$1", [plan.id, forgedHash]);
      try {
        assert.equal(await recover(), null);
      } finally {
        await app.db.pool.query('UPDATE translation_plans SET plan=$2,result=$3 WHERE id=$1', [plan.id, JSON.stringify(plan), JSON.stringify(partial)]);
      }

      const savedTitle = structuredClone(bundle.vehicle.draft.content.title.translations.en);
      const savedHuman = structuredClone(bundle.vehicle.draft.content.description.translations.ru);
      const partialSave = adopt(bundle, partial, ['content.description']);
      partialSave.content.description.translations.en = { ...partialSave.content.description.translations.en!,
        text: 'Employee retained 5-way adjustment text', kind: 'human', engineVersion: null };
      bundle = await save(partialSave);
      const changed = structuredClone(bundle.vehicle.draft);
      changed.configuration!.items.find(item => item.name === seatLabel)!.value = nextSeatText;
      const edited = await call({ method: 'PATCH', url: vehicleUrl, headers, payload: { version: bundle.vehicle.version, draft: changed } });
      assert.equal(edited.statusCode, 200, edited.body);
      bundle = await read();
      const receipt = await recover();
      assert.deepEqual(receipt, { plan, result: partial,
        adoptionBase: { vehicleVersion: bundle.vehicle.version, localizationRevision: bundle.localization.revision },
        blockedTargets: [{ ref: 'content.description', targetLocale: 'en' }, { ref: seatValue, targetLocale: 'en' }],
      });
      assert.deepEqual(await storedPlan(), beforeRecovery);
      assert.equal(providerCalls.length, paidBeforeRecovery);
      assert.equal(reservedCharacters, reservedBeforeRecovery);

      const overwrite = adopt(bundle, partial, [seatName]);
      overwrite.content.description.translations.en = { ...partial.fields.find(field => field.ref === 'content.description')!.translations.en!,
        humanEditVersion: bundle.vehicle.draft.content.description.translations.en!.humanEditVersion };
      const protectedSave = await call({ method: 'PUT', url: bundleUrl, headers, payload: overwrite });
      assert.equal(protectedSave.statusCode, 409, protectedSave.body);

      bundle = await save(adopt(bundle, receipt!.result, [seatName]));
      assert.equal(await recover(), null);
      assert.deepEqual(bundle.vehicle.draft.content.title.translations.en, savedTitle);
      assert.deepEqual(bundle.vehicle.draft.content.description.translations.ru, savedHuman);
      assert.equal(bundle.vehicle.draft.content.description.translations.en?.text, 'Employee retained 5-way adjustment text');
      assert.equal(bundle.localization.data.fields.find(field => field.ref === seatValue)?.translations.en, null);
      assert.deepEqual(bundle.localization.data.fields.find(field => field.ref === configRef), retained);
      assert.deepEqual(bundle.localization.data.fields.find(field => field.ref === 'model'), retainedModel);

      const forgedSource = structuredClone(saveInput(bundle));
      forgedSource.localization.fields.find(field => field.ref === configRef)!.sourceText += '篡改';
      const forbiddenSave = await call({ method: 'PUT', url: bundleUrl, headers, payload: forgedSource });
      assert.equal(forbiddenSave.statusCode, 409, forbiddenSave.body);
      const direct = structuredClone(bundle.localization.data);
      direct.fields.find(field => field.ref === configRef)!.translations.ru!.text = 'Рабочий объём (kWh)';
      const directSave = await call({ method: 'PUT', url: vehicleUrl + '/localization', headers, payload: {
        vehicleVersion: bundle.vehicle.version, revision: bundle.localization.revision, data: direct,
      } });
      assert.equal(directSave.statusCode, 200, directSave.body);
      bundle = await read();
      assert.equal(bundle.localization.data.fields.find(field => field.ref === configRef)?.translations.ru?.text, 'Рабочий объём (kWh)');
      const readiness = await call({ url: vehicleUrl + '/publish-readiness', headers });
      assert.equal(readiness.statusCode, 200, readiness.body);
      assert.ok(!readiness.json().data.issues.some((issue: { path: string }) => issue.path === 'localization.' + configRef + '.ru'));

      const retry = await createPlan(bundle.vehicle.version, 'missing');
      assert.deepEqual(exactTargets(retry), [['content.title', ['ru']], [seatValue, ['en']]]);
      const retried = await send(request(retry));
      assert.equal(retried.status, 'completed');
      assert.deepEqual(providerCalls.slice(before + 4), [{ text: titleText, target: 'ru' }, { text: nextSeatText, target: 'en' }]);
      bundle = await save(adopt(bundle, retried));
      const empty = await createPlan(bundle.vehicle.version, 'missing');
      assert.deepEqual(empty.fields, []);
      assert.equal(empty.estimate.maximumCharacters, 0);
      assert.equal(empty.estimate.maximumRequests, 0);
      const emptyRequest = request(empty), emptyResult = await send(emptyRequest);
      assert.deepEqual([emptyResult.status, emptyResult.fields, emptyResult.failures], ['completed', [], []]);
      assert.deepEqual(await send(emptyRequest), emptyResult);
      assert.equal(providerCalls.length, before + 6);
      assert.equal(reservedCharacters - budgetBefore, plan.estimate.maximumCharacters + retry.estimate.maximumCharacters);
      assert.equal((await app.db.pool.query("SELECT id FROM translation_plans WHERE id=$1 AND state='finished' AND NOT EXISTS(SELECT 1 FROM translation_plan_segments WHERE plan_id=$1)", [empty.id])).rowCount, 1);
      assert.equal((await read()).vehicle.draft.content.description.translations.ru?.reviewStatus, 'stale');
    });
    await t.test('two vehicles use the same exact configuration names without provider calls or quota', async () => {
      const before = providerCalls.length, quota = reservedCharacters;
      const fingerprints = new Set<string>();
      const labels = new Map([
        ['整车OTA升级', 'Обновление всего автомобиля по воздуху'], ['长度(mm)', 'Длина (мм)'],
      ]);
      for (const suffix of ['A', 'B']) {
        const sample = structuredClone(draft);
        sample.content.title.sourceText = `隔离词典用车 ${suffix}`;
        sample.configuration = { version: 1, items: [{ name: '整车OTA升级', value: '12' }, { name: '长度(mm)', value: '4200' }] };
        const created = await call({ method: 'POST', url: '/api/v1/admin/vehicles', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { draft: sample } });
        assert.equal(created.statusCode, 201, created.body);
        const path = '/api/v1/admin/vehicles/' + created.json().data.id;
        const bundleUrl = path + '/translation-bundle', planUrl = path + '/translation-plans';
        const read = await call({ url: bundleUrl, headers });
        const input = saveInput(VehicleTranslationBundleResponseSchema.parse(read.json()).data);
        for (const field of [input.content.title, input.content.description, ...input.localization.fields]) {
          for (const target of ['en', 'ru'] as const) {
            if (field.sourceText === null || (target === 'ru' && 'ref' in field && typeof field.ref === 'string' && field.ref.endsWith('.name') && labels.has(field.sourceText))) continue;
            const prefix = target === 'en' ? 'Reviewed ' : 'Проверено ';
            const text = field.sourceText === '整车OTA升级' ? 'Over-the-Air (OTA) vehicle upgrades' : prefix + field.sourceText;
            field.translations[target] = { text, kind: 'human', reviewStatus: 'approved', sourceVersion: field.sourceVersion,
              humanEditVersion: field.translations[target]?.humanEditVersion ?? 0, engineVersion: null };
          }
        }
        const saved = await call({ method: 'PUT', url: bundleUrl, headers, payload: input });
        assert.equal(saved.statusCode, 200, saved.body);
        const bundle = VehicleTranslationBundleResponseSchema.parse(saved.json()).data;
        const estimate = async (useCatalog?: true) => {
          const response = await call({ method: 'POST', url: planUrl, headers, payload: { version: bundle.vehicle.version, scope: 'missing', useCatalog } });
          assert.equal(response.statusCode, 200, response.body);
          return TranslationPlanResponseSchema.parse(response.json()).data;
        };
        const generate = (plan: Awaited<ReturnType<typeof estimate>>) => ({
          method: 'POST' as const, url: `${planUrl}/${plan.id}/generate`, headers: { ...headers, 'idempotency-key': randomUUID() },
          payload: { confirmed: true, sourceFingerprint: plan.sourceFingerprint, maximumCharacters: plan.estimate.maximumCharacters, acceptUnknownCost: false },
        });
        const legacy = await estimate();
        assert.equal(legacy.catalogVersion, undefined);
        assert.equal(legacy.estimate.maximumRequests, 2);
        assert.equal(legacy.estimate.cost.status, 'unknown');
        const declined = await call(generate(legacy));
        assert.equal(declined.statusCode, 422, declined.body);
        assert.match(declined.body, /TRANSLATION_CONFIRMATION_REQUIRED/);

        const plan = await estimate(true);
        fingerprints.add(plan.sourceFingerprint);
        assert.notEqual(plan.sourceFingerprint, legacy.sourceFingerprint);
        assert.equal(plan.catalogVersion, 'config-catalog:v1');
        assert.equal(plan.estimate.maximumCharacters, 0);
        assert.equal(plan.estimate.maximumRequests, 0);
        assert.deepEqual(plan.estimate.cost, { status: 'no_supplier_calls', amount: 0, currency: null, freeAllowanceCharacters: null });
        assert.deepEqual(new Set(plan.fields.map(field => field.sourceText)), new Set(labels.keys()));
        assert.ok(plan.fields.every(field => field.targets?.join() === 'ru' && field.catalogTargets?.join() === 'ru'));
        const request = generate(plan);
        const generated = await call(request);
        assert.equal(generated.statusCode, 200, generated.body);
        const result = TranslationPlanResultResponseSchema.parse(generated.json()).data;
        assert.equal(result.status, 'completed');
        assert.deepEqual(result.failures, []);
        const adopted = saveInput(bundle);
        for (const field of result.fields) {
          const suggestion = field.translations.ru!;
          assert.equal(suggestion.text, labels.get(field.sourceText));
          assert.equal(suggestion.kind, 'machine');
          assert.equal(suggestion.reviewStatus, 'pending');
          assert.equal(suggestion.engineVersion, 'config-catalog:v1');
          adopted.localization.fields.find(item => item.ref === field.ref)!.translations.ru = suggestion;
        }
        const segments = await app.db.pool.query('SELECT count(*)::int AS count FROM translation_plan_segments WHERE plan_id=$1', [plan.id]);
        assert.equal(segments.rows[0].count, 0);
        assert.deepEqual(TranslationPlanResultResponseSchema.parse((await call(request)).json()).data, result);
        const recovery = await call({ url: `${planUrl}/recoverable`, headers });
        assert.equal(recovery.statusCode, 200, recovery.body);
        assert.deepEqual(RecoverableTranslationPlanResponseSchema.parse(recovery.json()).data, { plan, result });
        const invalid = structuredClone(adopted);
        invalid.localization.fields.find(field => field.sourceText === '整车OTA升级')!.translations.ru!.text = 'OTA-обновление всего автомобиля';
        const forged = await call({ method: 'PUT', url: bundleUrl, headers, payload: invalid });
        assert.equal(forged.statusCode, 400, forged.body);
        const invalidBody = structuredClone(adopted);
        invalidBody.content.title.translations.en!.engineVersion = 'config-catalog:v1';
        const forgedBody = await call({ method: 'PUT', url: bundleUrl, headers, payload: invalidBody });
        assert.equal(forgedBody.statusCode, 400, forgedBody.body);
        const persisted = await call({ method: 'PUT', url: bundleUrl, headers, payload: adopted });
        assert.equal(persisted.statusCode, 200, persisted.body);
        const ota = VehicleTranslationBundleResponseSchema.parse(persisted.json()).data.localization.data.fields.find(field => field.sourceText === '整车OTA升级')!;
        assert.equal(ota.translations.en?.text, 'Over-the-Air (OTA) vehicle upgrades');
        assert.equal(ota.translations.ru?.engineVersion, 'config-catalog:v1');
      }
      assert.equal(fingerprints.size, 2);
      assert.equal(providerCalls.length, before);
      assert.equal(reservedCharacters, quota);
    });

    await t.test('nonblank Russian text remains complete through generation, save and publication readiness', async () => {
      const sample = structuredClone(draft);
      sample.configuration = { version: 1, items: [
        { name: '直流快充电量范围', value: '20–80%' },
        { name: '驾驶座调节', value: '4向电动调节' },
      ] };
      const created = await call({ method: 'POST', url: '/api/v1/admin/vehicles', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { draft: sample } });
      assert.equal(created.statusCode, 201, created.body);
      const vehicleId = created.json().data.id;
      const vehicleUrl = '/api/v1/admin/vehicles/' + vehicleId;
      const bundleUrl = vehicleUrl + '/translation-bundle', planUrl = vehicleUrl + '/translation-plans';
      const read = await call({ url: bundleUrl, headers });
      const input = saveInput(VehicleTranslationBundleResponseSchema.parse(read.json()).data);
      const planned = await call({ method: 'POST', url: planUrl, headers, payload: { version: input.version, scope: 'missing' } });
      assert.equal(planned.statusCode, 200, planned.body);
      const plan = TranslationPlanResponseSchema.parse(planned.json()).data;
      const generated = await call({ method: 'POST', url: planUrl + '/' + plan.id + '/generate',
        headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {
          confirmed: true, sourceFingerprint: plan.sourceFingerprint, maximumCharacters: plan.estimate.maximumCharacters, acceptUnknownCost: true,
        } });
      assert.equal(generated.statusCode, 200, generated.body);
      const result = TranslationPlanResultResponseSchema.parse(generated.json()).data;
      assert.equal(result.status, 'completed', JSON.stringify(result.failures));
      for (const field of result.fields) {
        const target = field.ref === 'content.title' ? input.content.title : field.ref === 'content.description' ? input.content.description :
          input.localization.fields.find(candidate => candidate.ref === field.ref)!;
        for (const locale of ['en', 'ru'] as const) {
          const suggestion = field.translations[locale];
          if (suggestion) target.translations[locale] = suggestion;
        }
      }
      const charging = input.localization.fields.find(field => field.sourceText === '直流快充电量范围')!;
      const adjustment = input.localization.fields.find(field => field.sourceText === '4向电动调节')!;
      assert.ok(charging.ref.endsWith('.name'));
      assert.ok(adjustment.ref.endsWith('.value'));
      for (const field of [charging, adjustment]) {
        assert.equal(field.translations.ru?.text, russianFactTranslations.get(field.sourceText));
        assert.equal(field.translations.ru?.reviewStatus, 'pending');
      }

      const attempt = (payload: SaveVehicleTranslationBundle) => call({ method: 'PUT', url: bundleUrl, headers, payload });
      const persisted = await attempt(input);
      assert.equal(persisted.statusCode, 200, persisted.body);
      const saved = VehicleTranslationBundleResponseSchema.parse(persisted.json()).data;
      const check = async () => {
        const response = await call({ url: vehicleUrl + '/publish-readiness?locale=ru', headers });
        assert.equal(response.statusCode, 200, response.body);
        return response.json().data;
      };
      const ready = await check();
      const factPaths = [charging, adjustment].map(field => 'localization.' + field.ref + '.ru');
      assert.ok(!ready.issues.some((issue: { path: string }) => factPaths.includes(issue.path)));
      assert.equal(ready.localizationReady, true);
      assert.equal(saved.vehicle.publicationState, 'draft');
      assert.equal(ready.previewConfirmed, false);

      const edited = structuredClone(saveInput(saved));
      const manualText = new Map([[charging.ref, 'Диапазон заряда при быстрой зарядке переменным током'],
        [adjustment.ref, 'Ручная регулировка в 4 направлениях']]);
      for (const [ref, text] of manualText) {
        const field = edited.localization.fields.find(item => item.ref === ref)!;
        field.translations.ru = { ...field.translations.ru!, text, kind: 'human', engineVersion: null };
      }
      const accepted = await attempt(edited);
      assert.equal(accepted.statusCode, 200, accepted.body);
      const revised = VehicleTranslationBundleResponseSchema.parse(accepted.json()).data;
      for (const [ref, text] of manualText)
        assert.equal(revised.localization.data.fields.find(field => field.ref === ref)?.translations.ru?.text, text);
      const updated = await check();
      assert.equal(updated.localizationReady, true);
      assert.equal(updated.translationWarnings, undefined);
      assert.ok(!updated.issues.some((issue: { path: string }) => factPaths.includes(issue.path)));
    });

    await t.test('nonblank human body text can be retained and rebound across source changes', async () => {
      for (const sourceText of ['额定功率100 kW', '额定功率85 kW。']) {
        const sample = structuredClone(draft);
        sample.content.description.sourceText = '额定功率85 kW';
        sample.content.description.translations.ru = { text: 'Номинальная мощность 85 кВт', kind: 'human',
          reviewStatus: 'pending', sourceVersion: 1, humanEditVersion: 0, engineVersion: null };
        const created = await call({ method: 'POST', url: '/api/v1/admin/vehicles',
          headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { draft: sample } });
        assert.equal(created.statusCode, 201, created.body);
        const vehicle = created.json().data;
        const vehicleUrl = '/api/v1/admin/vehicles/' + vehicle.id, bundleUrl = vehicleUrl + '/translation-bundle';
        vehicle.draft.content.description.sourceText = sourceText;
        const edited = await call({ method: 'PATCH', url: vehicleUrl, headers, payload: { version: vehicle.version, draft: vehicle.draft } });
        assert.equal(edited.statusCode, 200, edited.body);
        const read = async () => VehicleTranslationBundleResponseSchema.parse((await call({ url: bundleUrl, headers })).json()).data;
        const current = await read(), input = structuredClone(saveInput(current));
        const previous = current.vehicle.draft.content.description.translations.ru!;
        assert.equal(previous.reviewStatus, 'stale');
        const retained = input.content.description.translations.ru!;
        const rebound = { ...retained, sourceVersion: input.content.description.sourceVersion, reviewStatus: 'pending' as const };
        const replay = await call({ method: 'PUT', url: bundleUrl, headers, payload: input });
        assert.equal(replay.statusCode, 200, replay.body);
        const replayed = VehicleTranslationBundleResponseSchema.parse(replay.json()).data;
        assert.equal(replayed.vehicle.version, current.vehicle.version);
        assert.deepEqual(replayed.vehicle.draft.content.description.translations.ru, previous);

        input.content.description.translations.ru = rebound;
        const saved = await call({ method: 'PUT', url: bundleUrl, headers, payload: input });
        assert.equal(saved.statusCode, 200, saved.body);
        const after = await read();
        assert.equal(after.vehicle.version, current.vehicle.version + 1);
        assert.deepEqual(after.vehicle.draft.content.description.translations.ru, rebound);
      }
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
