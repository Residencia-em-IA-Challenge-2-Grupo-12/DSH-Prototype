import test from 'node:test';
import assert from 'node:assert/strict';
import { Calendarpit,resetScenario,draft,applyApproved,checkpoint,report } from '../src/core.mjs';

test('Calendarpit synthetic fixture: reset, propose, approve, edit and reconcile',async()=>{
  const c=new Calendarpit(); await resetScenario(c,'ana');
  const before=await c.events('ana'); assert(before.length>5);
  const plan=await draft(c,'ana',{weeks:4,hours:3});
  assert.equal((await c.events('ana')).length,before.length,'proposal cannot write');
  await applyApproved(c,'ana',plan.id,'near');
  assert.equal((await c.events('ana')).length,before.length+plan.near.length);
  const edited=plan.near[0];await c.patch('ana',edited.id,{summary:'User edited study'});
  const result=await checkpoint(c,'ana','Need a lighter week');
  assert(result.changes.some(x=>x.id===edited.id));
  const next=await draft(c,'ana',{weeks:4,hours:2});
  assert(!next.remove.near.some(x=>x.id===edited.id));
  await applyApproved(c,'ana',next.id,'near');
  assert((await c.events('ana')).some(x=>x.id===edited.id&&x.summary==='User edited study'));
  const metrics=await report(c,'ana');assert.equal(metrics.periods.recent.reportedMinutes,50);
  await resetScenario(c,'ana');assert.equal((await c.events('ana')).length,before.length);
});
