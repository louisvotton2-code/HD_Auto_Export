import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { readConfig } from './config.js';

// Schema generation never connects to a database or uses real environment secrets.
const config=readConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',AUTH_SECRET:'openapi-only-placeholder-not-a-live-secret'});
const {app}=await buildApp(config);
try {
  const document=app.swagger();
  // Binary bodies bypass JSON validators; describe their actual transport explicitly.
  const upload=document.paths?.['/api/v1/admin/media/{id}/content']?.put;
  if(upload) Object.assign(upload,{requestBody:{required:true,content:Object.fromEntries(['image/jpeg','image/png','image/webp'].map(type=>[type,{schema:{type:'string',format:'binary'}}]))}});
  for(const mediaPath of ['/api/v1/media/{id}','/api/v1/admin/media/{id}/preview']) {
    const get=document.paths?.[mediaPath]?.get;
    if(get) get.responses={'200':{description:'Processed image; access is checked on every request.',content:{'image/webp':{schema:{type:'string',format:'binary'}}}}};
  }
  const directory=fileURLToPath(new URL('../openapi/',import.meta.url));await mkdir(directory,{recursive:true});
  for(const audience of ['public','admin'] as const) {
    const copy=structuredClone(document);
    copy.paths=Object.fromEntries(Object.entries(copy.paths??{}).filter(([path])=>audience==='admin'?path.startsWith('/api/v1/admin/'):path.startsWith('/api/v1/')&&!path.startsWith('/api/v1/admin/')));
    if(audience==='public' && 'components' in copy && copy.components) delete copy.components.securitySchemes;
    await writeFile(`${directory}/${audience}.json`,`${JSON.stringify(copy,null,2)}\n`);
  }
} finally {await app.close();}
