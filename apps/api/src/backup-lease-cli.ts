import {parseArgs} from 'node:util';
import {createDatabase} from './db/index.js';
import {readDatabaseEnvironment} from './local-secrets.js';
import {changeBackupLease,validateBackupReference} from './backup-lease.js';
const {positionals,values}=parseArgs({allowPositionals:true,options:{reference:{type:'string'}}});
if(positionals.length!==1||!['acquire','release'].includes(positionals[0]!)||!values.reference)throw new Error('Use acquire|release --reference backup:<unique-job>');
validateBackupReference(values.reference);
const url=readDatabaseEnvironment().DATABASE_URL;if(!url)throw new Error('A database URL is required');
const db=createDatabase(url,1);
try{console.log(JSON.stringify(await changeBackupLease(db,positionals[0] as 'acquire'|'release',values.reference)));}finally{await db.close();}
