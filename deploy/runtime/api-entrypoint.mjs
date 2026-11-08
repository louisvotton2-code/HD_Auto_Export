import {readFile, readdir, lstat, chown} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const password=(await readFile('/run/secrets/app_db_password','utf8')).trim();
process.env.DATABASE_URL=`postgresql://hd_app:${encodeURIComponent(password)}@postgres:5432/hd_auto`;
process.env.AUTH_SECRET=(await readFile('/run/secrets/auth_secret','utf8')).trim();
// Docker Desktop may expose host bind mounts as root; fix ownership while root,
// then permanently drop privileges before executing application code.
const uid=Number(process.env.APP_UID),gid=Number(process.env.APP_GID);
if(!Number.isSafeInteger(uid)||uid<=0||!Number.isSafeInteger(gid)||gid<0) throw new Error('Invalid application identity');
const root=process.env.MEDIA_ROOT;
const rootStat=await lstat(root);
if(!rootStat.isDirectory()||rootStat.isSymbolicLink()) throw new Error('Invalid media root');
for(const name of await readdir(root)) {
  if(!/^[0-9a-f-]{36}(?:\.thumb)?\.webp$/.test(name)) throw new Error('Unexpected media entry');
  const file=path.join(root,name),stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1) throw new Error('Invalid media entry');
  await chown(file,uid,gid);
}
await chown(root,uid,gid);
process.setgroups([]);process.setgid(gid);process.setuid(uid);
const child=spawn(process.execPath,process.argv.slice(2),{stdio:'inherit',env:process.env});
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('API process could not start');process.exit(1);});
child.on('exit',(code,signal)=>process.exit(code??(signal?1:0)));
