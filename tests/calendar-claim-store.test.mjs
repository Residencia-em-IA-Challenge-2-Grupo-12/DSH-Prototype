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
    const claim={id:'operation-a',student:'ana',kind:'approval',proposalId:'proposal-a',section:'near',actions:[{type:'create',id:'event-a'}]};
    await first.acquireCalendarClaim(claim);
    assert.deepEqual(await second.getCalendarClaim(),{...claim,steps:[]});
    await assert.rejects(()=>second.acquireCalendarClaim({id:'operation-b',student:'bruno',kind:'reset',actions:[]}),/calendar operation.*unresolved/i);
    await second.appendCalendarClaimStep('operation-a',{actionId:'event-a',status:'sent'});
    const reopened=createStateStore(dir);
    assert.deepEqual((await reopened.getCalendarClaim()).steps,[{actionId:'event-a',status:'sent'}]);
    await assert.rejects(()=>first.appendCalendarClaimStep('operation-b',{status:'sent'}),/claim/i);
    assert.equal((await first.getCalendarClaim()).id,'operation-a');
  } finally {await rm(dir,{recursive:true,force:true});}
});
