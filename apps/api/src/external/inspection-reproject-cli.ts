import {parseArgs} from 'node:util';
import {createDatabase} from '../db/index.js';
import {readDatabaseEnvironment} from '../local-secrets.js';
import {reprojectStoredInspections} from './inspection-reproject.js';

async function run(){
 const {values}=parseArgs({options:{apply:{type:'boolean'},database:{type:'string'},after:{type:'string'},limit:{type:'string',default:'25'}},allowPositionals:false});
 const env=readDatabaseEnvironment(),address=new URL(env.DATABASE_URL??'');
 if(!values.apply||!values.database||!['postgres:','postgresql:'].includes(address.protocol)||decodeURIComponent(address.pathname.slice(1))!==values.database||
  env.NODE_ENV==='production'&&!/^(?:[a-f0-9]{40,64}|sha256:[a-f0-9]{64})$/.test(env.HD_RELEASE_ID??''))throw new Error('Explicit target required');
 const db=createDatabase(address.toString(),2);
 try{
  if((await db.pool.query('SELECT current_database() AS name')).rows[0]?.name!==values.database)throw new Error('Database mismatch');
  console.log(JSON.stringify(await reprojectStoredInspections(db,{after:values.after,limit:Number(values.limit)})));
 }finally{await db.close();}
}
void run().catch(()=>{console.error('Inspection reprojection failed; verify the explicit database, release, migration and bounded cursor.');process.exitCode=1;});
