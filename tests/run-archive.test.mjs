import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {archiveSyntheticRun} from '../src/foundation/run-archive.mjs';
import {createRunManager} from '../src/foundation/run-manager.mjs';

test('synthetic archive preserves approval and uncertain-write evidence while omitting free text and secrets',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-archive-')),id=randomUUID(),secret='synthetic-secret-never-archive';
  const event={id:'event1',summary:secret,description:secret,start:{dateTime:'2026-11-02T13:00:00-03:00'},end:{dateTime:'2026-11-02T14:00:00-03:00'},extendedProperties:{private:{studyDemo:'true',student:'ana',token:secret}}};
  const claim={id:'claim1',student:'ana',kind:'approval',section:'near',proposalId:'plan1',decision:{kind:'approved',section:'near',at:'2026-11-02T12:00:00Z',secret},
    actions:[{actionId:'create:event1',type:'create',event}],steps:[{actionId:'create:event1',status:'sent'}],token:secret};
  const snapshot={schemaVersion:1,state:{student:'ana',plan:{id:'plan1',status:{near:'partial',future:'pending'},near:[event],future:[],remove:{near:[],future:[]},outlook:[]},
    feedback:[{eventId:'event1',completion:'partial',actualMinutes:10,note:secret}],history:[{type:'partial-write',section:'near',planId:'plan1',error:secret,unknownAction:{type:'create',id:'event1'}}],narrative:secret},claim,claimHistory:[]};
  const input={directory,run:{id,student:'ana',createdAt:'2026-11-02T12:00:00Z'},snapshot,observation:{availability:'unavailable',events:null}};
  try {
    const result=await archiveSyntheticRun(input),file=join(directory,`${id}.json`),text=await readFile(file,'utf8'),record=JSON.parse(text);
    assert.equal(result.archiveId,id);assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.equal((await stat(file)).mode&0o777,0o600);
    assert(!text.includes(secret));assert.equal(record.observation.availability,'unavailable');assert.equal(record.observation.events,null);
    assert.equal(record.snapshot.claim.decision.kind,'approved');assert.equal(record.snapshot.claim.steps[0].status,'sent');
    assert.equal(record.snapshot.claim.actions[0].event.id,'event1');assert.match(record.snapshot.claim.actions[0].event.descriptionHash,/^[a-f0-9]{64}$/);
    assert.equal(record.snapshot.state.history[0].unknownAction.id,'event1');
    assert.deepEqual(await archiveSyntheticRun(input),result,'an identical retry after an uncertain archive result is idempotent');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('an archive never overwrites different existing evidence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-archive-existing-')),id=randomUUID(),file=join(directory,`${id}.json`);
  try {
    await writeFile(file,'existing evidence',{mode:0o600});
    await assert.rejects(archiveSyntheticRun({directory,run:{id,student:'ana',createdAt:'2026-11-02T12:00:00Z'},snapshot:{schemaVersion:1,state:null,claim:null,claimHistory:[]},observation:{availability:'unavailable',events:null}}),/already exists|different/i);
    assert.equal(await readFile(file,'utf8'),'existing evidence');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('lifecycle blocks replacement when archive fails, then records its hash after retry',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-archive-lifecycle-')),archiveDir=join(directory,'archive');let manager,simulatorStopped=false;
  const driver={async start(){},async stopWriters(){},
    archive:run=>archiveSyntheticRun({directory:archiveDir,run,snapshot:{schemaVersion:1,state:null,claim:null,claimHistory:[]},observation:{availability:'unavailable',events:null}}),
    async stopSimulator(){simulatorStopped=true;},async verifyRetired(){return true;}};
  try {
    await writeFile(archiveDir,'synthetic disk obstruction');
    manager=await createRunManager({root:join(directory,'registry'),driver});const run=await manager.start('ana');
    await assert.rejects(manager.retire(),/archive/i);assert.equal((await manager.current()).phase,'archive-failed');
    assert.equal(simulatorStopped,false);await assert.rejects(manager.start('bruno'),/active|unresolved/i);
    await rm(archiveDir);const result=await manager.retire();
    assert.equal(result.archiveId,run.id);assert.match(result.archiveSha256,/^[a-f0-9]{64}$/);
    const completed=await manager.completed(run.id);assert.equal(completed.archiveSha256,result.archiveSha256);
    assert.equal(await manager.current(),null);
  } finally {await manager?.close();await rm(directory,{recursive:true,force:true});}
});
