import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {panelData,placement,weekTime} from './panel-view.mjs';

const fixture=JSON.parse(await readFile(new URL('../../fixtures/calendars/ana.json',import.meta.url),'utf8'));
const work=fixture.events.find(e=>e.summary==='Part-time work'&&e.start.dateTime==='2026-11-02T08:00:00-03:00');
const study={id:'study',summary:'Synthetic study',start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}};
const common=()=>({calendar:{calendarId:'ana-calendar',timeZone:'America/Sao_Paulo',timeMin:'2026-11-02T00:00:00-03:00',timeMax:'2026-11-09T00:00:00-03:00',events:[work]},proposal:{payload:{sections:{near:{action:{type:'create',calendarId:'ana-calendar',event:study}}},sources:['course.md'],assumptions:[]}}});

test('common consumer create action appears as a proposed block in the view',()=>{
  const result=panelData(common());assert.equal(result.proposedCount,1);
  assert.equal(result.events[0].kind,'existing');assert.equal(result.events[1].kind,'add');
  assert.equal(result.events[1].id,'study');assert.deepEqual(placement(result.events[1]),{day:1,top:280,height:20});
});
test('real fictional fixture timestamps produce proportional positions',()=>{
  assert(work,'expected fixture event');assert.deepEqual(placement(work),{day:0,top:160,height:80});
  assert.deepEqual(weekTime('2026-11-08T09:30:00-03:00'),{day:6,hour:9.5});
  assert.equal(weekTime('2026-11-02T25:00:00-03:00'),null);
  assert.deepEqual(weekTime('2026-11-02T11:00:00Z'),{day:0,hour:8});
  assert.deepEqual(weekTime('2026-11-03T13:00:00-04:00'),{day:1,hour:14});
  assert.equal(weekTime('2026-11-09T03:00:00Z'),null);
  assert.equal(weekTime('2026-11-31T11:00:00Z'),null);
  assert.equal(weekTime('2026-11-02T08:00:00'),null);
});
test('unsupported proposal schemas never masquerade as an empty plan',()=>{
  const flat=common();flat.proposal.payload={near:[study]};assert.throws(()=>panelData(flat),/Unsupported proposal/);
  const remove=common();remove.proposal.payload.remove={near:[]};assert.throws(()=>panelData(remove),/Unsupported proposal/);
  const future=common();future.proposal.payload.sections.future={};assert.throws(()=>panelData(future),/Unsupported proposal/);
  const nestedRemove=common();nestedRemove.proposal.payload.sections.near.remove=[study];assert.throws(()=>panelData(nestedRemove),/Unsupported proposal/);
  const nestedUnknown=common();nestedUnknown.proposal.payload.sections.near.unexpected=true;assert.throws(()=>panelData(nestedUnknown),/Unsupported proposal/);
  const update=common();update.proposal.payload.sections.near.action.type='patch';assert.throws(()=>panelData(update),/Unsupported proposal/);
  const absent=common();delete absent.calendar.events;assert.throws(()=>panelData(absent),/Unsupported calendar/);
});

test('calendar and fixed-week metadata must match the proposal',()=>{
  const missing=common();delete missing.calendar.calendarId;assert.throws(()=>panelData(missing),/Unsupported calendar/);
  const other=common();other.calendar.calendarId='different';assert.throws(()=>panelData(other),/Unsupported proposal/);
  const zone=common();zone.calendar.timeZone='UTC';assert.throws(()=>panelData(zone),/Unsupported calendar/);
  const range=common();range.calendar.timeMin='2026-11-03T00:00:00-03:00';assert.throws(()=>panelData(range),/Unsupported calendar/);
  const utc=common();utc.calendar.timeMin='2026-11-02T03:00:00Z';utc.calendar.timeMax='2026-11-09T03:00:00Z';assert.equal(panelData(utc).proposedCount,1);
});
test('proposed blocks cannot disappear because of invalid or unsupported time',()=>{
  const outside=common();outside.proposal.payload.sections.near.action.event={...study,start:{dateTime:'2026-11-09T14:00:00-03:00'},end:{dateTime:'2026-11-09T15:00:00-03:00'}};assert.throws(()=>panelData(outside),/Unsupported proposed/);
  const invalid=common();invalid.proposal.payload.sections.near.action.event={...study,start:{dateTime:'2026-11-31T14:00:00-03:00'}};assert.throws(()=>panelData(invalid),/Unsupported proposed/);
  const minute=common();minute.proposal.payload.sections.near.action.event={...study,start:{dateTime:'2026-11-03T14:00:01-03:00'},end:{dateTime:'2026-11-03T14:00:59-03:00'}};assert.throws(()=>panelData(minute),/Unsupported proposed/);
  const utc=common();utc.proposal.payload.sections.near.action.event={...study,start:{dateTime:'2026-11-03T17:00:00Z'},end:{dateTime:'2026-11-03T18:00:00Z'}};assert.deepEqual(placement(panelData(utc).events[1]),{day:1,top:280,height:20});
});
test('malformed existing entries are rejected; valid all-day and multiday entries remain unsupported for display',()=>{
  for(const bad of [null,{}, {...work,start:{dateTime:'not-a-date'}}, {...work,end:{dateTime:'2026-11-02T07:00:00-03:00'}}]){const x=common();x.calendar.events=[bad];assert.throws(()=>panelData(x),/Unsupported calendar/);}
  const x=common();x.calendar.events=[{id:'all-day',summary:'All day',start:{date:'2026-11-02'},end:{date:'2026-11-03'}},{id:'overnight',summary:'Overnight',start:{dateTime:'2026-11-02T22:00:00-03:00'},end:{dateTime:'2026-11-03T07:00:00-03:00'}}];
  const events=panelData(x).events;assert.equal(placement(events[0]),null);assert.equal(placement(events[1]),null);
});
