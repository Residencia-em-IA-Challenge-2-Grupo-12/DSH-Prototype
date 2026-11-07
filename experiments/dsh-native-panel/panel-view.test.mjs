import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {panelData,placement,weekTime} from './panel-view.mjs';

const fixture=JSON.parse(await readFile(new URL('../../fixtures/calendars/ana.json',import.meta.url),'utf8'));
const work=fixture.events.find(e=>e.summary==='Part-time work'&&e.start.dateTime==='2026-11-02T08:00:00-03:00');
const study={id:'study',summary:'Synthetic study',start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}};
const common=()=>({calendar:{events:[work]},proposal:{payload:{sections:{near:{action:{type:'create',calendarId:'ana-calendar',event:study}}},sources:['course.md'],assumptions:[]}}});

test('common consumer create action appears as a proposed block in the view',()=>{
  const result=panelData(common());assert.equal(result.proposedCount,1);
  assert.equal(result.events[0].kind,'existing');assert.equal(result.events[1].kind,'add');
  assert.equal(result.events[1].id,'study');assert.deepEqual(placement(result.events[1]),{day:1,top:280,height:20});
});
test('real fictional fixture timestamps produce proportional positions',()=>{
  assert(work,'expected fixture event');assert.deepEqual(placement(work),{day:0,top:160,height:80});
  assert.deepEqual(weekTime('2026-11-08T09:30:00-03:00'),{day:6,hour:9.5});
  assert.equal(weekTime('2026-11-02T25:00:00-03:00'),null);
  assert.equal(weekTime('2026-11-02T08:00:00Z'),null);
});
test('unsupported proposal schemas never masquerade as an empty plan',()=>{
  const flat=common();flat.proposal.payload={near:[study]};assert.throws(()=>panelData(flat),/Unsupported proposal/);
  const remove=common();remove.proposal.payload.remove={near:[]};assert.throws(()=>panelData(remove),/Unsupported proposal/);
  const future=common();future.proposal.payload.sections.future={};assert.throws(()=>panelData(future),/Unsupported proposal/);
  const update=common();update.proposal.payload.sections.near.action.type='patch';assert.throws(()=>panelData(update),/Unsupported proposal/);
  const absent=common();delete absent.calendar.events;assert.throws(()=>panelData(absent),/Unsupported calendar/);
});
