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
  const publicMedia=document.paths?.['/api/v1/media/{id}']?.get;
  if(publicMedia) {
    const headers={
      ETag:{schema:{type:'string' as const},description:'Validator for the selected display image or derivative.'},
      'Cache-Control':{schema:{type:'string' as const},description:'A verified content version is public, max-age=31536000, immutable. Legacy published images revalidate with private, no-cache. Fallbacks and failures use no-store.'},
    };
    publicMedia.responses['200']={description:'Processed image. The id is a UUID or the versioned UUID from the public vehicle image URL.',
      content:{'image/webp':{schema:{type:'string',format:'binary'}}},headers};
    publicMedia.responses['304']={description:'Image unchanged after current publication access and file validation.',headers};
    publicMedia.responses['307']={description:'The versioned delivery budget has filled. Retry the legacy image address returned in Location.',
      headers:{Location:{schema:{type:'string'}},'Cache-Control':{schema:{type:'string',example:'no-store'}}}};
    publicMedia.responses['404']={description:'Current public image, version, or verified representation is unavailable.',
      headers:{'Cache-Control':{schema:{type:'string',example:'no-store'}}}};
  }
  const directory=fileURLToPath(new URL('../openapi/',import.meta.url));await mkdir(directory,{recursive:true});
  for(const audience of ['public','admin'] as const) {
    const copy=structuredClone(document);
    copy.paths=Object.fromEntries(Object.entries(copy.paths??{}).filter(([path])=>audience==='admin'?path.startsWith('/api/v1/admin/'):path.startsWith('/api/v1/')&&!path.startsWith('/api/v1/admin/')));
    if('components' in copy && copy.components?.securitySchemes) {
      if(audience==='public') delete copy.components.securitySchemes.staffSession;
      else delete copy.components.securitySchemes.salesService;
    }
    await writeFile(`${directory}/${audience}.json`,`${JSON.stringify(copy,null,2)}\n`);
  }
} finally {await app.close();}
