import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOT,readJSON,resetScenario,draftAnnotation,applyAnnotation,addFeedback,loadState,getRecoveryClaim} from '../src/core.mjs';

test('an annotation patch followed by an unavailable observation is not left pending',async()=>{
  const calendar={
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){if(this.offline)throw new Error('provider unavailable');return structuredClone(this.items);},
    async patch(_student,id,changes){Object.assign(this.items.find(event=>event.id===id),changes);this.offline=true;}
  };
  await resetScenario(calendar,'ana');
  const proposal=await draftAnnotation(calendar,'ana','ana-class','classes');
  const before=(await loadState('ana')).lastSnapshot;
  await assert.rejects(()=>applyAnnotation(calendar,'ana',proposal.id),/PARTIAL/);
  const state=await loadState('ana');
  assert.equal(state.pendingAnnotation.status,'partial');
  assert.deepEqual(state.lastSnapshot,before);
  assert.equal(state.history.findLast(item=>item.type==='annotation-partial').observation,'unavailable');
  const claim=await getRecoveryClaim();
  assert.equal(claim.kind,'annotation');
  assert(claim.steps.some(step=>step.status==='acknowledged'));
  assert(!claim.steps.some(step=>step.status==='confirmed'));
  calendar.offline=false;
  await assert.rejects(()=>applyAnnotation(calendar,'ana',proposal.id),/not pending/);
});

test('feedback saved while an annotation is being patched survives',async()=>{
  let release,started;
  const entered=new Promise(resolve=>{started=resolve;});
  const calendar={
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);},
    async patch(_student,id,changes){Object.assign(this.items.find(event=>event.id===id),changes);started();await new Promise(resolve=>{release=resolve;});}
  };
  await resetScenario(calendar,'ana');
  const proposal=await draftAnnotation(calendar,'ana','ana-class','classes');
  const applying=applyAnnotation(calendar,'ana',proposal.id);
  await entered;
  try {await addFeedback('ana',{eventId:'during-annotation'});} finally {release();}
  await applying;
  assert((await loadState('ana')).feedback.some(record=>record.eventId==='during-annotation'));
});
