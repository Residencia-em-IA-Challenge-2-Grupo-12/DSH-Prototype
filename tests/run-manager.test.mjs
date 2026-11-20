import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRunManager} from '../src/foundation/run-manager.mjs';

test('a replacement run waits for archived evidence and verified retirement',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-run-manager-'));
  let failArchive=true,retired=false;const calls=[];
  const driver={
    async start(run){calls.push(['start',run.id]);},
    async stopWriters(run){calls.push(['stop-writers',run.id]);},
    async archive(run){calls.push(['archive',run.id]);if(failArchive)throw Error('disk full');return {archiveId:run.id};},
    async stopSimulator(run){calls.push(['stop-simulator',run.id]);},
    async verifyRetired(run){calls.push(['verify',run.id]);return retired;}
  };
  let first,second;
  try {
    first=await createRunManager({root,driver});
    const run=await first.start('ana');
    second=await createRunManager({root,driver});
    assert.equal((await second.current()).id,run.id);
    await assert.rejects(()=>second.start('bruno'),/active|unresolved/i);
    await assert.rejects(()=>first.retire(),/archive/i);
    assert.equal((await second.current()).phase,'archive-failed');
    await assert.rejects(()=>second.start('bruno'),/active|unresolved/i);
    assert(!calls.some(([name])=>name==='stop-simulator'),'simulator was discarded after archive failure');
    failArchive=false;
    await assert.rejects(()=>second.retire(),/retir/i);
    assert.equal((await first.current()).phase,'retirement-failed');
    await assert.rejects(()=>first.start('bruno'),/active|unresolved/i);
    retired=true;await first.retire();
    assert.equal(await second.current(),null);
    const next=await second.start('bruno');assert.notEqual(next.id,run.id);
  } finally {await first?.close();await second?.close();await rm(root,{recursive:true,force:true});}
});

test('discarding unsaved synthetic evidence requires an explicit choice after an archive failure',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-run-discard-'));let archiveCalls=0,manager;
  const driver={async start(){},async stopWriters(){},async archive(){archiveCalls++;throw Error('disk full');},async stopSimulator(){},async verifyRetired(){return true;}};
  try {
    manager=await createRunManager({root,driver});await manager.start('ana');
    await assert.rejects(()=>manager.retire({discardUnsaved:true}),/archive failure/i);
    assert.equal(archiveCalls,0);
    await assert.rejects(()=>manager.retire(),/archive/i);
    const result=await manager.retire({discardUnsaved:true});
    assert.equal(result.discarded,true);assert.equal(result.archiveId,null);assert.equal(archiveCalls,1);
    assert.equal(await manager.current(),null);
  } finally {await manager?.close();await rm(root,{recursive:true,force:true});}
});

test('a failed startup retains its run identity and blocks another run until verified cleanup',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-run-start-fail-'));let manager,seen;
  const driver={async start(run){seen=run.id;throw Error('startup interrupted');},async stopWriters(){},async archive(run){return {archiveId:run.id};},async stopSimulator(){},async verifyRetired(){return true;}};
  try {
    manager=await createRunManager({root,driver});
    await assert.rejects(()=>manager.start('ana'),/startup failed/i);
    const active=await manager.current();assert.equal(active.id,seen);assert.equal(active.phase,'start-failed');
    await assert.rejects(()=>manager.start('bruno'),/active|unresolved/i);
    await manager.retire();assert.equal(await manager.current(),null);
  } finally {await manager?.close();await rm(root,{recursive:true,force:true});}
});

test('retirement retries retain the original startup-failure state',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-run-start-origin-'));let manager,seen=[];
  const driver={async start(){throw new Error('synthetic startup failure');},async stopWriters(run){seen.push(run.retireFromPhase);throw new Error('cannot verify');},
    async archive(run){return {archiveId:run.id};},async stopSimulator(){},async verifyRetired(){return true;}};
  try {
    manager=await createRunManager({root,driver});await assert.rejects(manager.start('ana'));
    await assert.rejects(manager.retire());await assert.rejects(manager.retire());
    assert.deepEqual(seen,['start-failed','start-failed']);
  } finally {await manager?.close();await rm(root,{recursive:true,force:true});}
});

test('a run is reserved before resource creation so another manager cannot start concurrently',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-run-reserve-'));let first,second,release,started;
  const entered=new Promise(resolve=>{started=resolve;});
  const driver={async start(){started();await new Promise(resolve=>{release=resolve;});},async stopWriters(){},async archive(run){return {archiveId:run.id};},async stopSimulator(){},async verifyRetired(){return true;}};
  try {
    first=await createRunManager({root,driver});second=await createRunManager({root,driver});
    const starting=first.start('ana');await entered;
    try {
      assert.equal((await second.current()).phase,'starting');
      await assert.rejects(()=>second.start('bruno'),/active|unresolved/i);
    } finally {release();}
    assert.equal((await starting).phase,'active');
  } finally {await first?.close();await second?.close();await rm(root,{recursive:true,force:true});}
});

test('an interrupted retirement remains visible and cannot be silently replaced', {timeout:10000}, async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-run-crash-')),ready=join(root,'retirement-started');
  const code=`import {createRunManager} from ${JSON.stringify(new URL('../src/foundation/run-manager.mjs',import.meta.url).href)};import {writeFile} from 'node:fs/promises';
    const driver={async start(){},async stopWriters(){},async archive(){await writeFile(process.argv[2],'ready');await new Promise(()=>setInterval(()=>{},1000));},async stopSimulator(){},async verifyRetired(){return true;}};
    const manager=await createRunManager({root:process.argv[1],driver});await manager.start('ana');await manager.retire();`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,root,ready],{stdio:'ignore'});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(_code,signal)=>resolve(signal));});
  let manager;
  try {
    let seen=false;const deadline=Date.now()+5000;
    while(Date.now()<deadline&&!seen){try{await access(ready);seen=true;}catch(error){if(error.code!=='ENOENT')throw error;}if(!seen)await new Promise(resolve=>setTimeout(resolve,20));}
    assert(seen,'retirement did not start');child.kill('SIGKILL');assert.equal(await exited,'SIGKILL');
    const driver={async start(){},async stopWriters(){},async archive(run){return {archiveId:run.id};},async stopSimulator(){},async verifyRetired(){return true;}};
    manager=await createRunManager({root,driver});
    assert.equal((await manager.current()).phase,'retiring');
    await assert.rejects(()=>manager.start('bruno'),/active|unresolved/i);
    await assert.rejects(()=>manager.retire(),/operation is in progress/i);
  } finally {child.kill('SIGKILL');await exited.catch(()=>{});await manager?.close();await rm(root,{recursive:true,force:true});}
});

test('forced stops and evidence discard require explicit boolean decisions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-run-decision-'));let manager,received;
  const driver={async start(){},async stopWriters(run,options){received={run,options};},async archive(run){return {archiveId:run.id};},async stopSimulator(){},async verifyRetired(){return true;}};
  try {
    manager=await createRunManager({root,driver});await manager.start('ana');
    await assert.rejects(()=>manager.retire({force:'true'}),/boolean/i);
    await assert.rejects(()=>manager.retire({discardUnsaved:'false'}),/boolean/i);
    assert.equal((await manager.current()).phase,'active');
    await manager.retire({force:true});
    assert.equal(received.options.force,true);
    assert.equal(received.run.forceRequested,true);
  } finally {await manager?.close();await rm(root,{recursive:true,force:true});}
});

test('retirement refuses a stale run identity before stopping any writer',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-run-stale-retire-'));let manager,stopped=false;
  const driver={async start(){},async stopWriters(){stopped=true;},async archive(run){return {archiveId:run.id};},async stopSimulator(){},async verifyRetired(){return true;}};
  try {
    manager=await createRunManager({root,driver});const run=await manager.start('ana');
    await assert.rejects(manager.retire({expectedRunId:'previous-run'}),/run.*changed/i);
    assert.equal(stopped,false);assert.equal((await manager.current()).id,run.id);
    await manager.retire({expectedRunId:run.id});assert.equal(stopped,true);
  } finally {await manager?.close();await rm(root,{recursive:true,force:true});}
});
