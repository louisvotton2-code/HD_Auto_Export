import { pathToFileURL } from 'node:url';
import { makeExternalCandidateFixture, makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import type { Config } from '../config.js';
import { readConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { buildProjection, emptyOverrides } from './normalize.js';

export const scaleCounts = [1000, 100_000, 500_000] as const;

/** Deterministic volume fixtures. Only an empty, migrated capacity database is accepted. */
export async function seedScale(config: Config, count: number) {
  if (!config.externalScale || !scaleCounts.some(allowed => allowed === count)) throw new Error('Invalid capacity fixture scope');
  const db = createDatabase(config.databaseUrl, 2);
  try {
    return await db.transaction(async tx => {
      await tx.query('SET LOCAL statement_timeout = \'10min\'');
      await tx.query('SELECT pg_advisory_xact_lock(78291332)');
      await tx.query('LOCK TABLE vehicles, external_listings IN SHARE ROW EXCLUSIVE MODE');
      const occupied = await tx.query<{ occupied: boolean }>(`SELECT EXISTS(SELECT 1 FROM vehicles) OR EXISTS(SELECT 1 FROM external_listings) AS occupied`);
      if (occupied.rows[0]?.occupied) throw new Error('Capacity fixture requires an empty catalog');

      // Distinct logical IDs are independent of database sequences or clock time.
      await tx.query(`CREATE TEMP TABLE scale_fixture ON COMMIT DROP AS
        SELECT n, (n % 100 = 0) AS staff,
          ('10000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid AS id,
          ('20000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid AS publication_id,
          ('30000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid AS media_id,
          timestamptz '2026-01-01T00:00:00Z' + n * interval '1 second' AS published_at,
          CASE WHEN n % 1000 = 7 THEN 'scale-rare' WHEN n % 10 < 6 THEN 'toyota' WHEN n % 2 = 0 THEN 'byd' ELSE 'geely' END AS make_id,
          'scale-model-' || lpad((n % 32)::text,2,'0') AS model_id,
          CASE WHEN n % 1000 = 7 THEN 'Scale rare' WHEN n % 10 < 6 THEN 'Toyota' WHEN n % 2 = 0 THEN 'BYD' ELSE 'Geely' END AS make_name,
          'Scale model ' || lpad((n % 32)::text,2,'0') AS model_name,
          CASE WHEN n % 23 = 0 AND n % 100 <> 0 THEN 'unknown' WHEN n % 3 = 0 THEN 'bev' WHEN n % 3 = 1 THEN 'petrol' ELSE 'phev' END AS power,
          2015 + n % 11 AS year,
          n * 37 % 240000 AS mileage,
          CASE WHEN n % 17 = 0 AND n % 100 <> 0 THEN NULL ELSE (40000 + n * 19 % 230000)::numeric END AS price
        FROM generate_series(1,$1::integer) n`, [count]);
      const candidate = makeExternalCandidateFixture(1);
      const projection = buildProjection(candidate, emptyOverrides(), 'Synthetic Market');
      // Leave the actual catalog/label triggers enabled so volume evidence uses normal indexed data.
      await tx.query(`ALTER TABLE scale_fixture ADD COLUMN facts jsonb;
        UPDATE scale_fixture SET facts = jsonb_build_object(
          'make',jsonb_build_object('id',make_id,'name',make_name),'model',jsonb_build_object('id',model_id,'name',model_name),
          'trim',NULL,'generation',NULL,'drivetrain','fwd','modelYear',year,'manufacturedAt',NULL,'firstRegistration',NULL,
          'registrationStatus','unknown','mileageKm',mileage,'powertrain',power,'engineCc',NULL,'powerKw',NULL,
          'body','suv','transmission','automatic','location',NULL)`);
      await tx.query(`INSERT INTO external_listings(id,provider,platform_id,external_id,source_revision,source_hash,source_data,upstream_state,fetched_at,source_updated_at,published_at)
        SELECT id,'synthetic-feed','synthetic-market','scale-'||n,1,md5('scale-v1:'||n),
          $1::jsonb || jsonb_build_object('externalId','scale-'||n,'listingUrl','https://listings.example.invalid/vehicles/scale-'||n,
            'facts',facts,'price',jsonb_build_object('cny',price::text),'fetchedAt',published_at,'sourceUpdatedAt',published_at),
          'active',published_at,published_at,published_at FROM scale_fixture WHERE NOT staff`, [JSON.stringify(candidate)]);
      await tx.query(`INSERT INTO external_catalog(listing_id,published_at,platform_name,listing_url,facts,price_cny,issues,localized,details)
        SELECT s.id,s.published_at,'Synthetic Market','https://listings.example.invalid/vehicles/scale-'||s.n,s.facts,s.price,'[]'::jsonb,
          l.localized,$2::jsonb
        FROM scale_fixture s CROSS JOIN LATERAL (
          SELECT jsonb_object_agg(x.key, x.value || jsonb_build_object(
            'title',(x.value->'title') || jsonb_build_object('text','Scale vehicle '||s.make_name||' '||s.model_name||' '||s.n,
              'contentLocale','en','kind','original'),
            'display',(x.value->'display') || jsonb_build_object(
              'make', (x.value->'display'->'make') || jsonb_build_object('text',s.make_name,'contentLocale','en','provenance','original'),
              'model',(x.value->'display'->'model') || jsonb_build_object('text',s.model_name,'contentLocale','en','provenance','original')))) AS localized
          FROM jsonb_each($1::jsonb) x
        ) l WHERE NOT s.staff`, [JSON.stringify(projection.localized), JSON.stringify({ original:{title:null,model:null,description:null},specifications:[],inspection:null,relatedListingUrls:[] })]);
      await tx.query(`INSERT INTO external_media(id,listing_id,source_media_id,url,width,height,position,active,refreshed_at)
        SELECT media_id,id,'scale-cover','https://photos.example.invalid/scale/'||n||'.webp',800,600,0,true,published_at
        FROM scale_fixture WHERE NOT staff`);

      const draft = makeVehicleDraftFixture();
      await tx.query(`INSERT INTO vehicles(id,stock_number,publication_state,availability,availability_checked_at,published_at)
        SELECT id,n,'published','available',published_at,published_at FROM scale_fixture WHERE staff`);
      await tx.query(`INSERT INTO vehicle_publications(id,vehicle_id,data)
        SELECT publication_id,id,jsonb_build_object('source',$1::jsonb,'facts',facts - 'generation' - 'drivetrain','content',$2::jsonb,
          'price',jsonb_build_object('kind','asking','money',jsonb_build_object('amount',price::text,'currency','CNY'),'includes','[]'::jsonb),
          'images',jsonb_build_array(jsonb_build_object('id',media_id,'url','/api/v1/media/'||media_id,'alt','','width',800,'height',600,'sortOrder',0,'isCover',true)))
        FROM scale_fixture WHERE staff`, [JSON.stringify(draft.source),JSON.stringify(draft.content)]);
      await tx.query(`INSERT INTO vehicle_drafts(vehicle_id,data)
        SELECT s.id,$1::jsonb || jsonb_build_object('facts',p.data->'facts','price',p.data->'price')
        FROM scale_fixture s JOIN vehicle_publications p ON p.id=s.publication_id WHERE s.staff`, [JSON.stringify(draft)]);
      await tx.query(`UPDATE vehicles v SET published_revision_id=s.publication_id FROM scale_fixture s WHERE s.staff AND s.id=v.id`);
      await tx.query(`SELECT setval('vehicle_stock_number',$1,true)`, [count]);
      const expected = await tx.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE staff)::int AS staff,
        count(*) FILTER(WHERE NOT staff)::int AS external,count(*) FILTER(WHERE make_id='toyota')::int AS toyota,
        count(*) FILTER(WHERE make_id='scale-rare')::int AS rare,count(*) FILTER(WHERE power='bev' AND year>=2020 AND price BETWEEN 60000 AND 120000)::int AS range,
        count(*) FILTER(WHERE make_id='toyota' AND round(price/7,2) BETWEEN 8000 AND 17000)::int AS usd_toyota_a,
        count(*) FILTER(WHERE make_id='toyota' AND round(price/8,2) BETWEEN 8000 AND 17000)::int AS usd_toyota_b
        FROM scale_fixture`);
      const samples = await tx.query(`SELECT id::text,n FROM scale_fixture WHERE n IN (1,7,100) ORDER BY n`);
      return { fixture:'scale-v1', expected:expected.rows[0], samples:samples.rows };
    });
  } finally { await db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] !== '--count' || process.argv.length !== 4 || !/^\d+$/.test(process.argv[3] ?? '')) {
      throw new Error('Usage: scale-seed --count 1000|100000|500000');
    }
    console.log(JSON.stringify(await seedScale(readConfig(), Number(process.argv[3]))));
  } catch {
    console.error('Capacity fixture failed. Use an empty, migrated, isolated database and an allowed record count.');
    process.exitCode = 1;
  }
}
