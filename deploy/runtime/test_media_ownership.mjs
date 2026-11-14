import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,link,unlink,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareMediaOwnership} from './media-ownership.mjs';
const id='01234567-0123-4123-8123-012345678901';
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'media-owner-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('upload tmp and transient publish link coexist with startup',async t=>{const root=await fixture(t);const tmp=path.join(root,`.${id}.${id}.tmp`);await writeFile(tmp,'image');await link(tmp,path.join(root,id+'.webp'));const pending=prepareMediaOwnership(root,process.getuid(),process.getgid());setTimeout(()=>unlink(tmp),20);await pending;});
test('unknown name and symlink are rejected',async t=>{const root=await fixture(t);await writeFile(path.join(root,'unknown.tmp'),'bad');await assert.rejects(prepareMediaOwnership(root,process.getuid(),process.getgid()));await unlink(path.join(root,'unknown.tmp'));await symlink('/etc/passwd',path.join(root,id+'.webp'));await assert.rejects(prepareMediaOwnership(root,process.getuid(),process.getgid()));});
test('persistent hardlink is rejected',async t=>{const root=await fixture(t);const file=path.join(root,id+'.webp');await writeFile(file,'image');await link(file,path.join(root,`.${id}.${id}.tmp`));await assert.rejects(prepareMediaOwnership(root,process.getuid(),process.getgid()));});
