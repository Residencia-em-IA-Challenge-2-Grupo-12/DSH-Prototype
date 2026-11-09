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
