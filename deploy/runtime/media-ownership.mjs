import {readdir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const temporary=new RegExp(`^\\.${uuid}\\.${uuid}(?:\\.thumb)?\\.tmp$`);
const formal=new RegExp(`^${uuid}(?:\\.thumb)?\\.webp$`);
// Concurrent uploads own temporary files; never open/chown them. Formal files
// are checked through an O_NOFOLLOW descriptor, so a path replacement cannot
// turn the ownership adjustment into a write outside the media directory.
export async function prepareMediaOwnership(root,uid,gid) {
  for(const name of await readdir(root)) {
    if(temporary.test(name)) continue;
    if(!formal.test(name)) throw new Error('Unexpected media entry');
    let file;
    try { file=await open(path.join(root,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK); }
    catch(error) { if(error.code==='ENOENT') continue; throw error; }
    try {
      let stat=await file.stat();
      if(!stat.isFile()) throw new Error('Invalid media entry');
      // Atomic publish briefly links the new image before removing its tmp name.
      for(let attempts=0;stat.nlink===2&&attempts<10;attempts++) { await delay(50);stat=await file.stat(); }
      if(stat.nlink===0) continue; // Legitimate concurrent GC, fd remains safe.
      if(stat.nlink!==1) throw new Error('Invalid media entry');
      if(stat.uid!==uid||stat.gid!==gid) await file.chown(uid,gid);
    } finally { await file.close(); }
  }
}
