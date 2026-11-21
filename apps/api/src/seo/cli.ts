import { createDatabase } from '../db/index.js';
import { readDatabaseEnvironment } from '../local-secrets.js';
import { refreshSeoSelection } from './service.js';
// Operator-only local command. Merely enabling public indexing never runs a selection write.
async function main() {
 if(process.argv.slice(2).join(' ')!=='--refresh-selection')throw new Error('Expected --refresh-selection.');
 const env=readDatabaseEnvironment();
 const databaseUrl=env.DATABASE_URL;
 if(!databaseUrl)throw new Error('DATABASE_URL is required.');
 const parsed=new URL(databaseUrl),expected=env.SEO_SELECTION_DATABASE;
 if(!expected||decodeURIComponent(parsed.pathname.slice(1))!==expected)throw new Error('SEO_SELECTION_DATABASE must explicitly name the target database.');
 const db=createDatabase(databaseUrl,1);
 try {if((await db.pool.query('SELECT current_database() AS name')).rows[0]?.name!==expected)throw new Error('SEO database mismatch.');
  console.log(JSON.stringify(await refreshSeoSelection(db)));
 } finally {await db.close();}
}
main().catch(()=>{console.error('SEO selection refresh failed; selection is unchanged unless a complete transaction committed.');process.exitCode=1;});
