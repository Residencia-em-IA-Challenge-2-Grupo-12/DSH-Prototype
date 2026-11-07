import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {panelData,placement,weekTime,eventLabel,eventPresentation,hourLabels,viewNotices,eventTypeLabels} from './panel-view.mjs';
import {makePlan} from '../../src/core.mjs';

const fixture=JSON.parse(await readFile(new URL('../../fixtures/calendars/ana.json',import.meta.url),'utf8'));
const work=fixture.events.find(e=>e.summary==='Part-time work'&&e.start.dateTime==='2026-11-02T08:00:00-03:00');
const study={id:'abcde0123456',summary:'Synthetic study',description:'Review sample material',status:'confirmed',start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'},extendedProperties:{private:{studyDemo:'true',student:'ana',course:'Example'}}};
const common=()=>({calendar:{calendarId:'ana-calendar',timeZone:'America/Sao_Paulo',timeMin:'2026-11-02T00:00:00-03:00',timeMax:'2026-11-09T00:00:00-03:00',events:[work]},proposal:{payload:{sections:{near:{action:{type:'create',calendarId:'ana-calendar',event:study}}},sources:['course.md'],assumptions:[]}}});

test('common consumer create action appears as a proposed block in the view',()=>{
  const result=panelData(common());assert.equal(result.proposedCount,1);
  assert.equal(result.events[0].kind,'existing');assert.equal(result.events[1].kind,'add');
  assert.equal(result.events[1].id,'abcde0123456');assert.equal(result.description,'Review sample material');assert.deepEqual(placement(result.events[1]),{day:1,top:280,height:20});
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

test('actual shared planner event satisfies the narrow viewer contract',async()=>{
  const profile=JSON.parse(await readFile(new URL('../../fixtures/students/ana/courses.json',import.meta.url),'utf8'));
  const event=makePlan(profile,fixture.events,{weeks:1,hours:1,protectedIds:fixture.events.map(item=>item.id)}).near[0];
  assert(event,'synthetic planner must produce a block');
  const x=common();x.proposal.payload.sections.near.action.event=event;
  assert.equal(panelData(x).events.at(-1).id,event.id);
});
test('cancelled tombstones are filtered, tentative and transparent events are labeled',()=>{
  const x=common();x.calendar.events=[{id:'cancelled-id',status:'cancelled'},{...work,status:'tentative',transparency:'transparent'}];
  const out=panelData(x);assert.equal(out.events.length,2);assert.equal(out.events[0].id,work.id);
  assert.match(eventLabel(out.events[0]),/Tentative/);assert.match(eventLabel(out.events[0]),/Does not block time/);
  assert.match(eventLabel(out.events[0],true),/Provisório/);assert.match(eventLabel(out.events[0],true),/Não bloqueia horário/);
  const tentative=common();tentative.proposal.payload.sections.near.action.event={...study,status:'tentative'};
  assert.match(eventLabel(panelData(tentative).events.at(-1)),/Tentative/);
});
test('expanded recurring instances are allowed, but series masters and unknown statuses are rejected',()=>{
  const expanded=common();expanded.calendar.events=[{...work,recurringEventId:'series-1'}];assert.equal(panelData(expanded).events.length,2);
  const master=common();master.calendar.events=[{...work,recurrence:['RRULE:FREQ=WEEKLY']}];assert.throws(()=>panelData(master),/Unsupported calendar/);
  for(const event of [{...work,recurrence:[]},{...work,recurrence:undefined},{...work,endTimeUnspecified:true},{...work,endTimeUnspecified:'true'},{...work,recurringEventId:''},{...work,recurringEventId:'  '},{...work,recurringEventId:3},{...work,recurringEventId:undefined}]){const x=common();x.calendar.events=[event];assert.throws(()=>panelData(x),/Unsupported calendar/);}
  const specified=common();specified.calendar.events=[{...work,endTimeUnspecified:false}];assert.equal(panelData(specified).events.length,2);
  const status=common();status.calendar.events=[{...work,status:'unknown'}];assert.throws(()=>panelData(status),/Unsupported calendar/);
  const transparency=common();transparency.calendar.events=[{...work,transparency:'mystery'}];assert.throws(()=>panelData(transparency),/Unsupported calendar/);
});
test('unsafe or unrepresented proposed event semantics fail closed',()=>{
  const cases=[
    {...study,id:'bad-id'}, {...study,summary:'  '}, {...study,recurrence:['RRULE:FREQ=WEEKLY']},
    {...study,recurringEventId:'series'}, {...study,attendees:[{email:'x@example.test'}]},
    {...study,location:'Somewhere'}, {...study,status:'cancelled'}, {...study,status:'unknown'},
    {...study,transparency:'transparent'}, {...study,transparency:'unknown'},
    {...study,extendedProperties:undefined}, {...study,extendedProperties:{private:{studyDemo:'true',student:'bruno'}}},
    {...study,extendedProperties:{private:{studyDemo:'true',student:'ana',extra:'hidden'}}},
    {...study,extendedProperties:{private:{studyDemo:'true',student:'ana'},shared:{hidden:'x'}}},
    {...study,start:{...study.start,timeZone:'UTC'}}, {...study,start:{...study.start,extra:'hidden'}}
  ];
  for(const event of cases){const x=common();x.proposal.payload.sections.near.action.event=event;assert.throws(()=>panelData(x),/Unsupported|ownership/);}
  const opaque=common();opaque.proposal.payload.sections.near.action.event={...study,transparency:'opaque'};assert.equal(panelData(opaque).proposedCount,1);
});
test('proposed identity cannot duplicate an observed event or cancelled tombstone',()=>{
  const existing=common();existing.calendar.events=[{...work,id:study.id}];assert.throws(()=>panelData(existing),/identity already exists/);
  const tombstone=common();tombstone.calendar.events=[{id:study.id,status:'cancelled'}];assert.throws(()=>panelData(tombstone),/identity already exists/);
});

test('hour axis and short events expose readable local times and accessible summaries',()=>{
  const hours=hourLabels();assert.equal(hours.length,24);assert.equal(hours[0],'00:00');assert.equal(hours[23],'23:00');
  const regular=eventPresentation({...work,kind:'existing'});assert.equal(regular.timeRange,'08:00–12:00');assert.equal(regular.visibleTop,160);assert.equal(regular.visibleHeight,80);assert.match(regular.accessibleText,/08:00–12:00.*São Paulo.*Part-time work/);
  const short={...study,kind:'add',status:'tentative',start:{dateTime:'2026-11-03T17:00:00Z'},end:{dateTime:'2026-11-03T17:01:00Z'}};
  const visible=eventPresentation(short,true);assert.equal(visible.timeRange,'14:00–14:01');assert.equal(visible.visibleHeight,20);assert.match(visible.accessibleText,/14:00–14:01.*Provisório.*Synthetic study/);
  const late={...study,kind:'add',start:{dateTime:'2026-11-08T23:58:00-03:00'},end:{dateTime:'2026-11-08T23:59:00-03:00'}};assert.equal(eventPresentation(late).visibleTop,460);
});
test('availability and short-event limitations are disclosed in both languages',()=>{
  assert.match(viewNotices.en.availability,/does not confirm availability/);assert.match(viewNotices.en.availability,/free\/busy/);
  assert.match(viewNotices.pt.availability,/não confirmam disponibilidade/);assert.match(viewNotices.pt.availability,/livre\/ocupado/);
  assert.match(viewNotices.en.short,/enlarged or shifted/);assert.match(viewNotices.pt.short,/ampliados ou deslocados/);
});

test('legend and block labels identify existing and proposed events in both languages',()=>{
  const view=panelData(common()), existing=view.events[0],proposed=view.events[1];
  assert.deepEqual(eventTypeLabels.en,{existing:'Existing',add:'Proposed'});
  assert.deepEqual(eventTypeLabels.pt,{existing:'Existente',add:'Proposto'});
  assert.match(eventPresentation(existing).label,/^Existing: Part-time work$/);
  assert.match(eventPresentation(existing).accessibleText,/Monday, 2 November 2026.*Existing: Part-time work/);
  assert.match(eventPresentation(proposed).label,/^Proposed: Synthetic study$/);
  assert.match(eventPresentation(proposed).accessibleText,/Proposed: Synthetic study/);
  assert.match(eventPresentation(existing,true).accessibleText,/Existente: Part-time work/);
  assert.match(eventPresentation(proposed,true).accessibleText,/Terça-feira, 3 de novembro de 2026.*Proposto: Synthetic study/);
  assert.throws(()=>eventLabel({...existing,kind:'other'}),/Unsupported event kind/);
});
