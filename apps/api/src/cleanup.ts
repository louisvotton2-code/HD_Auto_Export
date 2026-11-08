import { readConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { MediaService } from './media/service.js';
import { LocalMediaStore } from './media/storage.js';

const config=readConfig();const db=createDatabase(config.databaseUrl,2);
try {console.log(await new MediaService(db,new LocalMediaStore(config.mediaRoot)).cleanupExpired());}
finally {await db.close();}
