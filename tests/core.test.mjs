import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Calendarpit, makePlan, getStudent, listWorkspace, readWorkspace, resetScenario, draft, applyApproved, checkpoint, addFeedback, report, readJSON, ROOT, draftAnnotation, applyAnnotation } from '../src/core.mjs';

class FakeCalendar {
  async reset(student) { this.items=structuredClone((await readJSON(ROOT+'/fixtures/calendars/'+student+'.json')).events); }
  async events() { return structuredClone(this.items); }
  async create(student,event) { if(this.failAfter===0)throw Error('injected failure'); if(this.failAfter!=null)this.failAfter--; this.items.push(structuredClone(event)); return event; }
  async remove(student,id) { this.items=this.items.filter(e=>e.id!==id); }
  async patch(student,id,patch) { const e=this.items.find(e=>e.id===id); Object.assign(e,patch); return e; }
}
test('workspace selection is scoped and both fixture trees contain course content',async()=>{
  for(const id of ['ana','bruno']){
    const files=await listWorkspace(id,'courses'); assert(files.some(f=>f.name.endsWith('.pdf'))); assert(files.some(f=>f.name.endsWith('.md')));
    assert((await readWorkspace(id,'courses/'+files.find(f=>f.name.endsWith('.md')).name)).length>80);
    assert.match(await readWorkspace(id,'courses/course-outline.pdf'),/Synthetic course outline/);
    await assert.rejects(()=>readWorkspace(id,'../../../../etc/passwd'));
  }
});
test('planner avoids commitments, honors horizon and exposes shortfalls',async()=>{
  const calendar=new FakeCalendar(); await resetScenario(calendar,'ana'); await resetScenario(calendar,'bruno');
  const student=await getStudent('ana'), fixture=await readJSON(ROOT+'/fixtures/calendars/ana.json');
  const p=makePlan(student,fixture.events,{weeks:4,hours:6});
  assert.equal(p.outlook.length,4); assert.equal(p.near.length,6); assert.equal(p.outlook[0].shortfall,0);
  for(const block of [...p.near,...p.future])for(const existing of fixture.events)assert(!(Date.parse(block.start.dateTime)<Date.parse(existing.end.dateTime)&&Date.parse(existing.start.dateTime)<Date.parse(block.end.dateTime)));
  const p2=makePlan(student,fixture.events,{weeks:4,hours:20}); assert(p2.outlook[0].shortfall>0);
  const bruno=await getStudent('bruno'), p3=makePlan(bruno,[],{weeks:6,hours:5});assert.equal(p3.outlook.length,6);
});
test('approval is section-specific and stale proposals cannot write',async()=>{
  const c=new FakeCalendar();await resetScenario(c,'ana');let p=await draft(c,'ana',{weeks:2,hours:2});let initial=(await c.events()).length;
  assert.equal((await c.events()).length,initial); await applyApproved(c,'ana',p.id,'near');
  assert.equal((await c.events()).length,initial+p.near.length);
  await c.patch('ana','ana-class',{summary:'User edited class'});
  await assert.rejects(()=>applyApproved(c,'ana',p.id,'future'),/STALE/);
  assert.equal((await c.events()).length,initial+p.near.length);
});
test('manual edits are preserved when replanning and checkpoint records changes',async()=>{
  const c=new FakeCalendar();await resetScenario(c,'ana');let p=await draft(c,'ana',{weeks:2,hours:2});await applyApproved(c,'ana',p.id,'near');
  const id=p.near[0].id;await c.patch('ana',id,{summary:'User custom study'});
  const observed=await checkpoint(c,'ana','Need fewer hours');assert(observed.changes.some(x=>x.id===id));
  p=await draft(c,'ana',{weeks:2,hours:1});assert(!p.remove.near.some(x=>x.id===id));
  await applyApproved(c,'ana',p.id,'near');assert((await c.events()).some(e=>e.id===id&&e.summary==='User custom study'));
});
test('partial writes are recorded and cannot be retried blindly',async()=>{
  const c=new FakeCalendar();await resetScenario(c,'ana');const p=await draft(c,'ana',{weeks:1,hours:3});c.failAfter=1;
  await assert.rejects(()=>applyApproved(c,'ana',p.id,'near'),/PARTIAL/);
  await assert.rejects(()=>applyApproved(c,'ana',p.id,'near'),/not pending/);
});
test('concurrent approvals cannot duplicate a proposal',async()=>{
  const c=new FakeCalendar();await resetScenario(c,'ana');const p=await draft(c,'ana',{weeks:1,hours:2});
  const results=await Promise.allSettled([applyApproved(c,'ana',p.id,'near'),applyApproved(c,'ana',p.id,'near')]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await c.events()).length,7);
});
test('feedback remains optional and report separates reported minutes',async()=>{
  const c=new FakeCalendar();await resetScenario(c,'ana');await addFeedback('ana',{eventId:'ana-class',completion:'unknown',actualMinutes:20,effort:2,note:'optional'});
  const result=await report(c,'ana');assert.equal(result.reportedMinutes,70);assert.equal(result.feedbackCount,2);assert.equal(result.missingCompletion,1);
  assert(result.limitations.some(x=>x.includes('not demonstrate')));
});
test('annotation requires review and preserves the original event description',async()=>{
  const c=new FakeCalendar();await resetScenario(c,'ana');
  const original=(await c.events()).find(x=>x.id==='ana-class').description;
  const proposal=await draftAnnotation(c,'ana','ana-class','classes');
  assert.equal((await c.events()).find(x=>x.id==='ana-class').description,original);
  await applyAnnotation(c,'ana',proposal.id);
  assert((await c.events()).find(x=>x.id==='ana-class').description.includes(original));
  const next=await draftAnnotation(c,'ana','ana-class','work');
  await c.patch('ana','ana-work',{summary:'Externally modified'});
  await assert.rejects(()=>applyAnnotation(c,'ana',next.id),/STALE/);
});
test('Calendarpit adapter rejects nonlocal service endpoints',()=>{
  assert.throws(()=>new Calendarpit('http://example.com:4173'));assert.throws(()=>new Calendarpit('https://127.0.0.1:4173'));
});
test('MCP server initializes and exposes no approval or calendar-write tool',async()=>{
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport=new StdioClientTransport({command:process.execPath,args:[ROOT+'/src/mcp.mjs']});
  const client=new Client({name:'test',version:'1.0.0'});
  try {
    await client.connect(transport);
    const tools=await client.listTools();const names=tools.tools.map(t=>t.name);
    assert(names.includes('draft_study_plan'));assert(!names.some(n=>/approve|apply|delete|write_calendar/.test(n)));
    const out=await client.callTool({name:'list_synthetic_files',arguments:{student:'ana',path:'courses'}});assert(!out.isError,JSON.stringify(out));
  } finally { await client.close(); }
});
