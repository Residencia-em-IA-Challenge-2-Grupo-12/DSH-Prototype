import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { ROOT,readJSON,resetScenario,draft,applyApproved,checkpoint,getStudent,makePlan,runtimeDir } from '../src/core.mjs';

class ScenarioCalendar {
  async reset(student){this.eventsData=structuredClone((await readJSON(ROOT+'/fixtures/calendars/'+student+'.json')).events);}
  async events(){return structuredClone(this.eventsData);}
  async create(student,event){this.eventsData.push(structuredClone(event));return event;}
  async patch(student,id,changes){Object.assign(this.eventsData.find(e=>e.id===id),changes);}
  async remove(student,id){this.eventsData=this.eventsData.filter(e=>e.id!==id);}
}
async function baseline() {
  const c=new ScenarioCalendar();await resetScenario(c,'ana');
  const plan=await draft(c,'ana',{weeks:4,hours:6});await applyApproved(c,'ana',plan.id,'near');return {c,plan};
}
test('checkpoint: reduced hours produces a smaller reviewed proposal',async()=>{
  const {c,plan}=await baseline();await checkpoint(c,'ana','I need fewer hours to feel better.');const before=await c.events();
  const next=await draft(c,'ana',{weeks:4,hours:3});
  assert.equal(next.near.length,3);assert.equal(next.remove.near.length,plan.near.length);
  assert.deepEqual(await c.events(),before,'draft must not write');
});
test('checkpoint: a new commitment is detected and avoided in a revised proposal',async()=>{
  const {c,plan}=await baseline();const b=plan.near[0];
  await c.create('ana',{id:'new-commitment',summary:'New commitment',start:b.start,end:b.end});
  const observed=await checkpoint(c,'ana','A commitment was added.');assert(observed.changes.some(x=>x.id==='new-commitment'));
  const next=await draft(c,'ana',{weeks:4,hours:6});
  assert(!next.near.some(x=>x.start.dateTime===b.start.dateTime));
});
test('checkpoint: changed synthetic syllabus deadline changes the outlook',async()=>{
  const {c}=await baseline();await checkpoint(c,'ana','The project deadline moved.');
  const file=runtimeDir()+'/workspaces/ana/courses/machine-learning.md',syllabus=await fs.readFile(file,'utf8');
  await fs.writeFile(file,syllabus.replace('2026-11-30','2026-11-16'));
  const next=await draft(c,'ana',{weeks:4,hours:6});assert.equal(next.outlook.length,3);
});
