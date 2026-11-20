import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStateStore} from '../src/state-store.mjs';

test('an archive snapshot includes unresolved and completed approval evidence without changing it',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-archive-state-'));
  try {
    const store=createStateStore(directory);await store.create('ana',{student:'ana',plan:{id:'plan1',status:{near:'pending'}}});
    await store.acquireCalendarClaim({id:'claim1',student:'ana',kind:'approval',section:'near',decision:{kind:'approved',section:'near'},
      actions:[{actionId:'create:one',type:'create',event:{id:'one'}}]});
    await store.appendCalendarClaimStep('claim1',{actionId:'create:one',status:'sent'});
    const pending=await store.snapshotForArchive('ana');
    assert.equal(pending.state.plan.id,'plan1');assert.equal(pending.claim.id,'claim1');
    assert.deepEqual(pending.claim.steps.map(step=>step.status),['sent']);assert.deepEqual(pending.claimHistory,[]);
    pending.claim.steps[0].status='modified';
    assert.equal((await store.getCalendarClaim()).steps[0].status,'sent');
    await store.appendCalendarClaimStep('claim1',{actionId:'create:one',status:'acknowledged'});
    await store.appendCalendarClaimStep('claim1',{actionId:'create:one',status:'confirmed'});
    await store.completeCalendarClaim('claim1',{student:'ana'});
    const completed=await store.snapshotForArchive('ana');
    assert.equal(completed.claim,null);assert.equal(completed.claimHistory[0].disposition,'completed');
    assert.deepEqual(completed.claimHistory[0].steps.map(step=>step.status),['sent','acknowledged','confirmed']);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('archive snapshots expose a missing state and never misattribute another student claim',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-archive-empty-'));
  try {
    const store=createStateStore(directory);
    assert.equal((await store.snapshotForArchive('ana')).state,null);
    await store.acquireCalendarClaim({id:'other',student:'bruno',kind:'reset',actions:[{actionId:'reset:bruno'}]});
    await assert.rejects(store.snapshotForArchive('ana'),/student/i);
  } finally {await rm(directory,{recursive:true,force:true});}
});
