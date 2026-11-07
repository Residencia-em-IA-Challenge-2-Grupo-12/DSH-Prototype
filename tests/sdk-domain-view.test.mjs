import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {readDomainView} from '../experiments/sdk-ui/domain-view.mjs';
import {createDomainReadHandler} from '../experiments/sdk-ui/domain-read-server.mjs';

const origin='http://127.0.0.1:4176', id='demo-proposal';
const event={id:'abcde12345',summary:'Synthetic study',extendedProperties:{private:{studyDemo:'true',student:'ana'}},start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}};
function fixture(){return {versions:{context:1,evidence:1,calendar:1},calendar:{student:'ana',kind:'calendar',version:1,payload:{calendarId:'ana-calendar',timeZone:'America/Sao_Paulo',timeMin:'2026-11-02T00:00:00-03:00',timeMax:'2026-11-09T00:00:00-03:00',events:[{...event,id:'existing',summary:'Synthetic class'}]}},proposal:{id,student:'ana',versions:{context:1,evidence:1,calendar:1},payload:{sections:{near:{action:{type:'create',calendarId:'ana-calendar',event:structuredClone(event)}}}}}};}
function fakeFetch(data,{after}={}){
  let versionReads=0;const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method,redirect:options.redirect});
    const suffix=new URL(url).pathname.replace('/v1/students/ana','');
    let result=suffix==='/versions'?(++versionReads===1?data.versions:after||data.versions):suffix==='/revisions/calendar/1'?data.calendar:suffix==='/proposals/'+id?data.proposal:null;
    return {ok:!!result,status:result?200:404,json:async()=>structuredClone(result)};
  };
  return {fetchImpl,calls};
}
function request(handler,{method='GET',url='/',host='127.0.0.1:4444',remote='127.0.0.1'}={}){
  const req=Readable.from([]);Object.assign(req,{method,url,headers:{host},socket:{remoteAddress:remote}});
  return new Promise((resolve,reject)=>{const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){resolve({status:this.status,body:body?.toString()})}};Promise.resolve(handler(req,res)).catch(reject)});
}
test('domain reader uses only GET and preserves the selected shared proposal and observation',async()=>{
  const data=fixture(),fake=fakeFetch(data),view=await readDomainView({origin,proposalId:id,fetchImpl:fake.fetchImpl});
  assert.equal(view.student,'ana');assert.deepEqual(view.versions,data.versions);assert.deepEqual(view.calendar,data.calendar.payload);assert.deepEqual(view.proposal,data.proposal);assert.equal(view.stale,false);
  assert.equal(fake.calls.length,4);assert(fake.calls.every(x=>x.method==='GET'&&x.redirect==='error'));
  data.proposal.versions.context=2;assert.equal((await readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(data).fetchImpl})).stale,true);
});
test('domain reader fails closed on malformed identities, changes and non-loopback origins',async()=>{
  const data=fixture();await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(data,{after:{...data.versions,context:2}}).fetchImpl}),/changed during read/);
  data.calendar.student='bruno';await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(data).fetchImpl}),/calendar revision identity/);
  await assert.rejects(()=>readDomainView({origin:'http://example.test:4176',proposalId:id,fetchImpl:fakeFetch(fixture()).fetchImpl}),/loopback/);
  const bad=fixture();delete bad.proposal.payload.sections.near.action.event;await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(bad).fetchImpl}),/unsupported proposal/);
});
test('domain reader refuses proposal changes the narrow view cannot display',async()=>{
  const cases=[
    ['top-level removal',p=>{p.remove=['existing']}],
    ['top-level future',p=>{p.future=[event]}],
    ['near removal',p=>{p.sections.near.remove=['existing']}],
    ['near future',p=>{p.sections.near.future=[event]}],
    ['invalid sources',p=>{p.sources=['ok',{}]}],
    ['invalid assumptions',p=>{p.assumptions=null}],
    ['future section',p=>{p.sections.future={action:p.sections.near.action}}],
  ];
  for(const [name,mutate] of cases){
    const data=fixture();mutate(data.proposal.payload);
    await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(data).fetchImpl}),/unsupported proposal/,name);
  }
  const valid=fixture();valid.proposal.payload.sources=['course.md'];valid.proposal.payload.assumptions=['Synthetic'];
  assert.equal((await readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(valid).fetchImpl})).proposal.id,id);
});
test('proposal event fields must match the supported owned single-create contract',async()=>{
  const invalid=[
    ['recurrence',e=>{e.recurrence=['RRULE:FREQ=DAILY']}],
    ['attendees',e=>{e.attendees=[{email:'fictional@example.test'}]}],
    ['cancelled',e=>{e.status='cancelled'}],
    ['transparent',e=>{e.transparency='transparent'}],
    ['unknown status',e=>{e.status='unknown'}],
    ['bad id',e=>{e.id='invalid-id'}],
    ['blank summary',e=>{e.summary='  '}],
    ['missing owner',e=>{delete e.extendedProperties}],
    ['wrong owner',e=>{e.extendedProperties.private.student='bruno'}],
    ['extra metadata',e=>{e.extendedProperties.private.hidden='x'}],
    ['shared metadata',e=>{e.extendedProperties.shared={x:'y'}}],
    ['unsupported time field',e=>{e.start.extra='x'}],
    ['different endpoint zone',e=>{e.start.timeZone='UTC'}],
  ];
  for(const [name,mutate] of invalid){const d=fixture();mutate(d.proposal.payload.sections.near.action.event);await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(d).fetchImpl}),/unsupported proposal/i,name);}
  const valid=fixture();valid.proposal.payload.sections.near.action.event.status='tentative';
  assert.equal((await readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(valid).fetchImpl})).proposal.id,id);
});
test('cancelled tombstones are accepted, but masters and duplicate proposed IDs fail closed',async()=>{
  const tombstone=fixture();tombstone.calendar.payload.events.push({id:'deleted',status:'cancelled'});
  assert.equal((await readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(tombstone).fetchImpl})).proposal.id,id);
  const master=fixture();master.calendar.payload.events[0].recurrence=['RRULE:FREQ=DAILY'];
  await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(master).fetchImpl}),/invalid calendar event/i);
  const emptyMaster=fixture();emptyMaster.calendar.payload.events[0].recurrence=[];
  await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(emptyMaster).fetchImpl}),/invalid calendar event/i);
  const noEnd=fixture();noEnd.calendar.payload.events[0].endTimeUnspecified=true;
  await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(noEnd).fetchImpl}),/invalid calendar event/i);
  const badSeries=fixture();badSeries.calendar.payload.events[0].recurringEventId='';
  await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(badSeries).fetchImpl}),/invalid calendar event/i);
  const repeated=fixture();repeated.calendar.payload.events.push({...repeated.calendar.payload.events[0]});
  await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(repeated).fetchImpl}),/invalid calendar event/i);
  const duplicate=fixture();duplicate.calendar.payload.events.push({id:'abcde12345',status:'cancelled'});
  await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(duplicate).fetchImpl}),/already exists/i);
});
test('domain reader requires the matching calendar and the supported São Paulo week',async()=>{
  for(const [name,mutate] of [
    ['different calendar',d=>{d.calendar.payload.calendarId='other-calendar'}],
    ['missing calendar',d=>{delete d.calendar.payload.calendarId}],
    ['missing timezone',d=>{delete d.calendar.payload.timeZone}],
    ['wrong timezone',d=>{d.calendar.payload.timeZone='UTC'}],
    ['wrong start',d=>{d.calendar.payload.timeMin='2026-11-03T00:00:00-03:00'}],
    ['wrong end',d=>{d.calendar.payload.timeMax='2026-11-10T00:00:00-03:00'}],
  ]){const d=fixture();mutate(d);await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(d).fetchImpl}),/calendar|week/i,name);}
  const d=fixture();d.calendar.payload.timeMin='2026-11-02T03:00:00Z';d.calendar.payload.timeMax='2026-11-09T03:00:00Z';
  assert.equal((await readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(d).fetchImpl})).proposal.id,id);
});

test('domain reader rejects invisible or malformed proposed blocks but accepts equivalent UTC times',async()=>{
  for(const [name,start,end] of [
    ['not a date','not-a-date','2026-11-03T15:00:00-03:00'],
    ['impossible date','2026-02-30T14:00:00-03:00','2026-11-03T15:00:00-03:00'],
    ['missing offset','2026-11-03T14:00:00','2026-11-03T15:00:00-03:00'],
    ['invalid offset','2026-11-04T07:00:00+14:30','2026-11-04T08:00:00+14:30'],
    ['zero duration','2026-11-03T14:00:00-03:00','2026-11-03T14:00:00-03:00'],
    ['reversed','2026-11-03T15:00:00-03:00','2026-11-03T14:00:00-03:00'],
    ['outside week','2026-11-09T14:00:00-03:00','2026-11-09T15:00:00-03:00'],
    ['crosses midnight','2026-11-03T23:00:00-03:00','2026-11-04T01:00:00-03:00'],
    ['sub-minute block','2026-11-03T14:00:10-03:00','2026-11-03T14:00:40-03:00']
  ]){const d=fixture(),e=d.proposal.payload.sections.near.action.event;e.start={dateTime:start};e.end={dateTime:end};await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(d).fetchImpl}),/proposal|block/i,name);}
  const d=fixture(),e=d.proposal.payload.sections.near.action.event;e.start={dateTime:'2026-11-03T17:00:00Z'};e.end={dateTime:'2026-11-03T18:00:00Z'};
  assert.equal((await readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(d).fetchImpl})).proposal.id,id);
  e.start={dateTime:'2026-11-04T07:00:00+14:00'};e.end={dateTime:'2026-11-04T08:00:00+14:00'};
  assert.equal((await readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(d).fetchImpl})).proposal.id,id);
});

test('domain reader rejects malformed existing events and accepts valid all-day or multiday entries',async()=>{
  for(const [name,bad] of [
    ['null',null],['missing ID',{summary:'Class',start:{dateTime:'2026-11-02T09:00:00-03:00'},end:{dateTime:'2026-11-02T10:00:00-03:00'}}],
    ['bad start',{id:'bad',summary:'Class',start:{dateTime:'invalid'},end:{dateTime:'2026-11-02T10:00:00-03:00'}}],
    ['mixed types',{id:'bad',summary:'Class',start:{date:'2026-11-02'},end:{dateTime:'2026-11-02T10:00:00-03:00'}}],
    ['bad all-day date',{id:'bad',summary:'Class',start:{date:'2026-02-30'},end:{date:'2026-03-02'}}]
  ]){const d=fixture();d.calendar.payload.events=[bad];await assert.rejects(()=>readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(d).fetchImpl}),/calendar|event/i,name);}
  const d=fixture();d.calendar.payload.events=[
    {id:'all-day',summary:'Holiday',start:{date:'2026-11-02'},end:{date:'2026-11-03'}},
    {id:'overnight',summary:'Overnight',start:{dateTime:'2026-11-02T23:00:00-03:00'},end:{dateTime:'2026-11-03T01:00:00-03:00'}}
  ];assert.equal((await readDomainView({origin,proposalId:id,fetchImpl:fakeFetch(d).fetchImpl})).calendar.events.length,2);
});
test('comparison handler exposes read-only state and rejects every non-GET request',async()=>{
  const data=fixture(),fake=fakeFetch(data),handler=createDomainReadHandler({origin,proposalId:id,fetchImpl:fake.fetchImpl},()=>4444);
  for(const url of ['/api/review','/api/plan','/api/approve'])assert.equal((await request(handler,{method:'POST',url})).status,405);
  assert.equal((await request(handler,{host:'example.test:4444'})).status,403);
  const state=JSON.parse((await request(handler,{url:'/api/state'})).body);
  assert.equal(state.readOnly,true);assert.equal(state.student,'ana');assert.equal(state.proposal.id,id);assert.deepEqual(state.events,data.calendar.payload.events);
});
test('real client script hides review controls and marks a shared proposal stale',async()=>{
  const source=await readFile(new URL('../experiments/sdk-ui/app.js',import.meta.url),'utf8');
  const nodes=new Map();function element(){return {style:{},children:[],textContent:'',hidden:false,append(...v){this.children.push(...v)},replaceChildren(){this.children=[]},addEventListener(){}};}
  const document={querySelector(key){if(!nodes.has(key))nodes.set(key,element());return nodes.get(key)},querySelectorAll(){return []},createElement(){return element()}};
  const data=fixture();data.proposal.payload.sources='invalid';data.proposal.payload.assumptions=null;const state={readOnly:true,stale:true,events:[],proposal:data.proposal,calendarStatus:'shared-point-in-time',outcome:null};
  vm.runInNewContext(source,{document,fetch:async()=>({ok:true,json:async()=>state}),Intl,Date});
  await new Promise(resolve=>setImmediate(resolve));
  for(const key of ['#draft','#approve','#reject'])assert.equal(nodes.get(key).hidden,true);
  assert.match(nodes.get('#status').textContent,/stale/);assert.match(nodes.get('#calendar-state').textContent,/Read-only shared calendar snapshot/);assert.equal(nodes.get('#source').textContent,'Not provided');assert.equal(nodes.get('#assumption').textContent,'Not provided');
});
