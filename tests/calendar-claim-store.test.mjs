import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStateStore} from '../src/state-store.mjs';

test('a durable calendar claim is shared between store instances and students',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'study-calendar-claim-'));
  try {
    const first=createStateStore(dir),second=createStateStore(dir);
    const claim={id:'operation-a',student:'ana',kind:'approval',proposalId:'proposal-a',section:'near',actions:[{actionId:'create:event-a',type:'create',id:'event-a'}]};
    await first.acquireCalendarClaim(claim);
    assert.deepEqual(await second.getCalendarClaim(),{...claim,steps:[]});
    await assert.rejects(()=>second.acquireCalendarClaim({id:'operation-b',student:'bruno',kind:'reset',actions:[]}),/calendar operation.*unresolved/i);
    await second.appendCalendarClaimStep('operation-a',{actionId:'create:event-a',status:'sent'});
    const reopened=createStateStore(dir);
    assert.deepEqual((await reopened.getCalendarClaim()).steps,[{actionId:'create:event-a',status:'sent'}]);
    await assert.rejects(()=>first.appendCalendarClaimStep('operation-b',{status:'sent'}),/claim/i);
    assert.equal((await first.getCalendarClaim()).id,'operation-a');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('claim acquisition and state validation are atomic, and only confirmed actions can finish',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'study-calendar-atomic-'));
  try {
    const a=createStateStore(dir),b=createStateStore(dir);
    await a.save('ana',{student:'ana',plan:{id:'proposal',status:'pending'}});
    const claim={id:'approval-1',student:'ana',kind:'approval',actions:[{actionId:'create:event'}]};
    await a.acquireCalendarClaim(claim,{student:'ana',change:state=>{
      assert.equal(state.plan.status,'pending');state.plan.status='applying';
    }});
    assert.equal((await b.load('ana')).plan.status,'applying');
    await assert.rejects(()=>a.appendCalendarClaimStep('approval-1',{actionId:'create:other',status:'sent'}),/action/i);
    await assert.rejects(()=>a.appendCalendarClaimStep('approval-1',{actionId:'create:event',status:'confirmed'}),/order/i);
    await assert.rejects(()=>b.update('ana',state=>{state.plan=null;},{requiresIdle:true}),/unresolved/i);
    await b.update('ana',state=>{state.note='unrelated feedback';});
    await assert.rejects(()=>b.completeCalendarClaim('approval-1',{student:'ana',change:()=>{}}),/unconfirmed/i);
    await a.appendCalendarClaimStep('approval-1',{actionId:'create:event',status:'sent'});
    await assert.rejects(()=>b.cancelCalendarClaim('approval-1',{student:'ana'}),/sent/i);
    await a.appendCalendarClaimStep('approval-1',{actionId:'create:event',status:'acknowledged'});
    await a.appendCalendarClaimStep('approval-1',{actionId:'create:event',status:'confirmed'});
    await b.completeCalendarClaim('approval-1',{student:'ana',change:state=>{state.plan.status='applied';}});
    assert.equal(await a.getCalendarClaim(),null);
    assert.equal((await a.load('ana')).note,'unrelated feedback');
    assert.equal((await a.load('ana')).plan.status,'applied');
  } finally {await rm(dir,{recursive:true,force:true});}
});
