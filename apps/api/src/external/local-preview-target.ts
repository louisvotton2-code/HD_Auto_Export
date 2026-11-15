export function assertLocalPreviewTarget(env:NodeJS.ProcessEnv){
 const u=new URL(env.DATABASE_URL??'');
 if(env.NODE_ENV!=='development'||env.HD_DEPLOYMENT_ENV!=='local'||!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||!/^\/hd_local_preview(?:_test_[a-f0-9]+)?$/.test(u.pathname)||u.hash||u.searchParams.getAll('host').length>1||[...u.searchParams.keys()].some(k=>k!=='host')||u.searchParams.has('host')&&!u.searchParams.get('host')!.startsWith('/')||env.TRANSLATION_PROVIDER&&env.TRANSLATION_PROVIDER!=='disabled')throw new Error('Local preview requires a dedicated loopback hd_local_preview database, development/local and disabled translation');
 return u.toString();
}
