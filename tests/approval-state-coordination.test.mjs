import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOT, readJSON, resetScenario, draft, applyApproved, addFeedback, loadState} from '../src/core.mjs';

test('feedback saved while a calendar approval is running survives the application', async()=>{
  let release, started;
  const entered=new Promise(resolve=>{started=resolve;});
  const calendar={
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);},
    async create(_student,event){
      this.items.push(structuredClone(event));
      started();await new Promise(resolve=>{release=resolve;});
      return event;
    },
    async remove(_student,id){this.items=this.items.filter(event=>event.id!==id);}
  };
  await resetScenario(calendar,'ana');
  const plan=await draft(calendar,'ana',{weeks:1,hours:1});
  assert.equal(plan.near.length,1);
  const applying=applyApproved(calendar,'ana',plan.id,'near');
  await entered;
  try {await addFeedback('ana',{eventId:'during-approval',note:'keep this feedback'});}
  finally {release();}
  await applying;
  const state=await loadState('ana');
  assert(state.feedback.some(record=>record.eventId==='during-approval'));
  assert.equal(state.plan.status.near,'applied');
});

test('a newer proposal is not silently replaced when an earlier approval finishes', async()=>{
  let release, started;
  const entered=new Promise(resolve=>{started=resolve;});
  const calendar={
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);},
    async create(_student,event){this.items.push(structuredClone(event));started();await new Promise(resolve=>{release=resolve;});return event;},
    async remove(_student,id){this.items=this.items.filter(event=>event.id!==id);}
  };
  await resetScenario(calendar,'ana');
  const first=await draft(calendar,'ana',{weeks:1,hours:1});
  const applying=applyApproved(calendar,'ana',first.id,'near');
  await entered;
  let newer;
  try {newer=await draft(calendar,'ana',{weeks:1,hours:2});}
  finally {release();}
  await assert.rejects(applying,/proposal was replaced/);
  const state=await loadState('ana');
  assert.equal(state.plan.id,newer.id);
  assert(state.history.some(item=>item.planId===first.id&&item.type==='approved'&&item.superseded));
});

test('a failed post-write observation records a partial approval without inventing calendar state',async()=>{
  const calendar={
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){if(this.offline)throw new Error('provider unavailable');return structuredClone(this.items);},
    async create(_student,event){this.items.push(structuredClone(event));this.offline=true;return event;},
    async remove(_student,id){this.items=this.items.filter(event=>event.id!==id);}
  };
  await resetScenario(calendar,'ana');
  const plan=await draft(calendar,'ana',{weeks:1,hours:1});
  const before=(await loadState('ana')).lastSnapshot;
  await assert.rejects(()=>applyApproved(calendar,'ana',plan.id,'near'),/PARTIAL/);
  const state=await loadState('ana');
  assert.equal(state.plan.status.near,'partial');
  assert.deepEqual(state.lastSnapshot,before);
  const failure=state.history.findLast(item=>item.type==='partial-write');
  assert.deepEqual(failure.written,[plan.near[0].id]);
  assert.equal(failure.observation,'unavailable');
});

test('a user edit during a multi-action application is protected from later removal',async()=>{
  const calendar={
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);},
    async create(_student,event){this.items.push(structuredClone(event));return event;},
    async remove(_student,id){
      this.items=this.items.filter(event=>event.id!==id);
      if(this.editOnRemove){const edited=this.items.find(event=>event.id===this.editOnRemove);if(edited)edited.summary='User changed this study block';this.editOnRemove=null;}
    }
  };
  await resetScenario(calendar,'ana');
  const initial=await draft(calendar,'ana',{weeks:1,hours:2});
  await applyApproved(calendar,'ana',initial.id,'near');
  const replacement=await draft(calendar,'ana',{weeks:1,hours:1});
  assert.equal(replacement.remove.near.length,2);
  const editedId=replacement.remove.near[1].id;
  calendar.editOnRemove=editedId;
  await assert.rejects(()=>applyApproved(calendar,'ana',replacement.id,'near'),/PARTIAL/);
  assert.equal((await calendar.events()).find(event=>event.id===editedId)?.summary,'User changed this study block');
  const next=await draft(calendar,'ana',{weeks:1,hours:1});
  assert(!next.remove.near.some(event=>event.id===editedId));
});

test('a lost create response is reported as unknown even when a later read finds the event',async()=>{
  const calendar={
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);},
    async create(_student,event){this.items.push(structuredClone(event));throw new Error('response lost');},
    async remove(_student,id){this.items=this.items.filter(event=>event.id!==id);}
  };
  await resetScenario(calendar,'ana');
  const plan=await draft(calendar,'ana',{weeks:1,hours:1});
  await assert.rejects(()=>applyApproved(calendar,'ana',plan.id,'near'),/outcome unknown/);
  const state=await loadState('ana');
  const failure=state.history.findLast(item=>item.type==='partial-write');
  assert.deepEqual(failure.written,[]);
  assert.deepEqual(failure.unknownAction,{type:'create',id:plan.near[0].id});
  assert((await calendar.events()).some(event=>event.id===plan.near[0].id));
});
