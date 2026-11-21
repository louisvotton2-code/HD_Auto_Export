import {parseArgs} from 'node:util';
import {createDatabase} from '../db/index.js';
import {readDatabaseEnvironment} from '../local-secrets.js';
import {reprojectStoredInspections,withholdUnverifiableInspections} from './inspection-reproject.js';

async function run(){
 const {values}=parseArgs({options:{apply:{type:'boolean'},database:{type:'string'},after:{type:'string'},limit:{type:'string'},
  'withhold-unverifiable':{type:'boolean'},'listing-id':{type:'string',multiple:true}},allowPositionals:false});
 const env=readDatabaseEnvironment(),address=new URL(env.DATABASE_URL??'');
 if(!values.apply||!values.database||!['postgres:','postgresql:'].includes(address.protocol)||decodeURIComponent(address.pathname.slice(1))!==values.database||
  env.NODE_ENV==='production'&&!/^(?:[a-f0-9]{40,64}|sha256:[a-f0-9]{64})$/.test(env.HD_RELEASE_ID??''))throw new Error('Explicit target required');
 const withhold=values['withhold-unverifiable'],listingIds=values['listing-id'];
 if(withhold?(!listingIds?.length||values.after!==undefined||values.limit!==undefined):listingIds!==undefined)
  throw new Error('Withholding requires explicit listing IDs and is separate from keyset reprojection.');
 const db=createDatabase(address.toString(),2);
 try{
  if((await db.pool.query('SELECT current_database() AS name')).rows[0]?.name!==values.database)throw new Error('Database mismatch');
  const result=withhold?await withholdUnverifiableInspections(db,{listingIds:listingIds!})
   :await reprojectStoredInspections(db,{after:values.after,limit:Number(values.limit??25)});
  console.log(JSON.stringify(result));
 }finally{await db.close();}
}
void run().catch(()=>{console.error('Inspection maintenance failed; verify the explicit database, release and listing IDs or batch cursor.');process.exitCode=1;});
