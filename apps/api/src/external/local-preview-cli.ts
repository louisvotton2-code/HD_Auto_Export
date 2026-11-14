import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {createDatabase} from '../db/index.js';
import {migrateDatabase} from '../db/migrate.js';
import {readDatabaseEnvironment} from '../local-secrets.js';
import {readDocuments} from './ingestion/snapshot.js';
import {assertLocalPreviewTarget,importLocalPreview} from './local-preview.js';
const {values}=parseArgs({options:{package:{type:'string'}}});
if(!values.package||!path.isAbsolute(values.package))throw new Error('Use --package <absolute private capture directory>');
const db=createDatabase(assertLocalPreviewTarget(readDatabaseEnvironment()),3);
try{
 await migrateDatabase(db);
 const selection=JSON.parse(await readFile(path.join(values.package,'selection.json'),'utf8'));
 const documents=readDocuments(path.join(values.package,'documents.jsonl'));
 const result=await importLocalPreview(db,{version:selection.version,batchKey:selection.batchKey,identities:selection.identities},documents);
 console.log(JSON.stringify({batchKey:selection.batchKey,...result,continuous:false,translationCalls:0}));
}finally{await db.close();}
