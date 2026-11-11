import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createExclusiveRunManager} from '../src/foundation/exclusive-run-manager.mjs';

test('a new controller cannot silently replace an existing run after lease handoff',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-exclusive-'));let first,second;
  const driver={async start(){},async stopWriters(){},async archive(run){return {archiveId:run.id};},async stopSimulator(){},async verifyRetired(){return true;}};
  try {
    first=await createExclusiveRunManager({root,driver});const run=await first.start('ana');
    await assert.rejects(createExclusiveRunManager({root,driver}),/already active/i);
    await first.close();second=await createExclusiveRunManager({root,driver});
    assert.equal((await second.current()).id,run.id);
    await assert.rejects(second.start('bruno'),/active|unresolved/i);
    await second.retire();assert.equal(await second.current(),null);
  } finally {await first?.close();await second?.close();await rm(root,{recursive:true,force:true});}
});

test('after a controller crash the next owner sees the unresolved run and cannot replace it automatically',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-exclusive-crash-'));
  const url=new URL('../src/foundation/exclusive-run-manager.mjs',import.meta.url).href;
  const source=`import {createExclusiveRunManager} from ${JSON.stringify(url)}; const driver={async start(){},async stopWriters(){},async archive(run){return {archiveId:run.id}},async stopSimulator(){},async verifyRetired(){return true}}; const manager=await createExclusiveRunManager({root:process.argv[1],driver}); const run=await manager.start('ana'); console.log(run.id); setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',source,root],{stdio:['ignore','pipe','pipe']});let diagnostic='';
  child.stderr.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-1000);});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(_code,signal)=>resolve(signal));});
  let next,stopped=false;
  const driver={async start(){},async stopWriters(){stopped=true;},async archive(run){assert(stopped);return {archiveId:run.id};},async stopSimulator(){},async verifyRetired(){return true;}};
  try {
    const id=await Promise.race([new Promise(resolve=>createInterface({input:child.stdout}).once('line',resolve)),
      exited.then(()=>{throw new Error(`Controller exited early: ${diagnostic}`);}),
      new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error(`Controller startup timed out: ${diagnostic}`)),4000);timer.unref();})]);
    await assert.rejects(createExclusiveRunManager({root,driver}),/already active/i);
    child.kill('SIGKILL');assert.equal(await exited,'SIGKILL');
    next=await createExclusiveRunManager({root,driver});assert.equal((await next.current()).id,id);
    await assert.rejects(next.start('bruno'),/active|unresolved/i);assert.equal(stopped,false);
    await next.retire();assert.equal(stopped,true);assert.equal(await next.current(),null);
  } finally {child.kill('SIGKILL');await exited.catch(()=>{});await next?.close();await rm(root,{recursive:true,force:true});}
});

test('closing a controller waits for its lifecycle operation before releasing the lease',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-exclusive-wait-'));let manager,release,started;
  const entered=new Promise(resolve=>{started=resolve;});
  const driver={async start(){started();await new Promise(resolve=>{release=resolve;});},async stopWriters(){},async archive(run){return {archiveId:run.id};},async stopSimulator(){},async verifyRetired(){return true;}};
  try {
    manager=await createExclusiveRunManager({root,driver});const starting=manager.start('ana');await entered;
    const closing=manager.close();await assert.rejects(createExclusiveRunManager({root,driver}),/already active/i);
    release();await starting;await closing;
    const next=await createExclusiveRunManager({root,driver});try{assert.equal((await next.current()).phase,'active');}finally{await next.close();}
  } finally {release?.();await manager?.close();await rm(root,{recursive:true,force:true});}
});
