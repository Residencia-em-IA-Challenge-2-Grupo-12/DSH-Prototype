// SHELL_COMPARISON_INTEGRATION=1 DSH_NATIVE_PANEL_ENTRY=/absolute/path/to/index.mjs node --test tests/sdk-native-shared-domain.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createDomainService} from '../src/domain-service.mjs';
import {createDomainReadServer} from '../experiments/sdk-ui/domain-read-server.mjs';

test('native host and custom shell read the same synthetic domain records without approval routes', {skip:process.env.SHELL_COMPARISON_INTEGRATION!=='1',timeout:15000},async()=>{
  const entry=process.env.DSH_NATIVE_PANEL_ENTRY;
  assert(entry&&path.isAbsolute(entry),'DSH_NATIVE_PANEL_ENTRY must name the absolute native panel index.mjs');
  const {PanelHost}=await import(pathToFileURL(entry).href);
  const {panelData}=await import(pathToFileURL(path.join(path.dirname(entry),'panel-view.mjs')).href);
  const service=createDomainService();let shell;
  try {
    const {port}=await service.listen(0);const origin=`http://127.0.0.1:${port}`,prefix='/v1/students/ana';
    const post=async(url,body)=>{const r=await fetch(origin+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,201);return r.json();};
    const existing={id:'synthetic-class',summary:'Synthetic class',start:{dateTime:'2026-11-02T09:00:00-03:00'},end:{dateTime:'2026-11-02T11:00:00-03:00'}};
    const event={id:'abcde12345',summary:'Synthetic study',extendedProperties:{private:{studyDemo:'true',student:'ana'}},start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}};
    for(const kind of ['context','evidence','calendar'])await post(prefix+'/revisions/'+kind,{expectedVersion:0,payload:kind==='calendar'?{calendarId:'ana-calendar',timeZone:'America/Sao_Paulo',timeMin:'2026-11-02T00:00:00-03:00',timeMax:'2026-11-09T00:00:00-03:00',events:[existing]}:{synthetic:true}});
    const proposal=await post(prefix+'/proposals',{versions:{context:1,evidence:1,calendar:1},payload:{sections:{near:{action:{type:'create',calendarId:'ana-calendar',event}}}}});
    shell=createDomainReadServer({origin,proposalId:proposal.id});
    await new Promise((resolve,reject)=>{shell.once('error',reject);shell.listen(0,'127.0.0.1',resolve)});
    const shellBase=`http://127.0.0.1:${shell.address().port}`;
    const native=()=>PanelHost.prototype.view.call({origin,selected:proposal.id,fetchImpl:fetch});
    const custom=async()=>{const r=await fetch(shellBase+'/api/state');assert.equal(r.status,200);return r.json()};
    let [a,b]=await Promise.all([native(),custom()]);
    assert.deepEqual(b.events,a.calendar.events);assert.deepEqual(b.proposal,a.proposal);assert.deepEqual(b.versions,a.versions);assert.equal(b.student,a.student);assert.equal(b.stale,a.stale);
    assert.equal(panelData(a).proposedCount,1);assert.equal(b.proposal.payload.sections.near.action.event.id,event.id);
    for(const url of ['/api/plan','/api/review','/api/approve']){
      const denied=await fetch(shellBase+url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(denied.status,405);
    }
    await post(prefix+'/revisions/context',{expectedVersion:1,payload:{synthetic:true,changed:true}});
    [a,b]=await Promise.all([native(),custom()]);assert.equal(a.stale,true);assert.equal(b.stale,true);assert.deepEqual(b.versions,a.versions);
    const decision=await fetch(origin+prefix+'/proposals/'+proposal.id+'/decisions/near');assert.equal(decision.status,404,'comparison must not record approval');
  } finally {
    if(shell?.listening)await new Promise((resolve,reject)=>shell.close(e=>e?reject(e):resolve()));
    await service.close();
  }
});

test('native and custom adapters agree on supported single-block schemas and timestamps', {skip:process.env.SHELL_COMPARISON_INTEGRATION!=='1',timeout:10000},async()=>{
  const entry=process.env.DSH_NATIVE_PANEL_ENTRY;assert(entry&&path.isAbsolute(entry));
  const {panelData}=await import(pathToFileURL(path.join(path.dirname(entry),'panel-view.mjs')).href);
  const {readDomainView}=await import('../experiments/sdk-ui/domain-view.mjs');
  const id='paired-proposal',versions={context:1,evidence:1,calendar:1};
  function payload(){
    const event={id:'abcde12345',summary:'Synthetic study',extendedProperties:{private:{studyDemo:'true',student:'ana'}},start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}};
    return {student:'ana',versions,calendar:{calendarId:'ana-calendar',timeZone:'America/Sao_Paulo',timeMin:'2026-11-02T00:00:00-03:00',timeMax:'2026-11-09T00:00:00-03:00',events:[]},proposal:{id,student:'ana',versions,payload:{sections:{near:{action:{type:'create',calendarId:'ana-calendar',event}}}}},stale:false};
  }
  const cases=[
    ['valid',()=>{},true],
    ['UTC equivalent',p=>{p.proposal.payload.sections.near.action.event.start.dateTime='2026-11-03T17:00:00Z';p.proposal.payload.sections.near.action.event.end.dateTime='2026-11-03T18:00:00Z'},true],
    ['all-day existing',p=>p.calendar.events.push({id:'all-day',summary:'Holiday',start:{date:'2026-11-02'},end:{date:'2026-11-03'}}),true],
    ['top-level removal',p=>{p.proposal.payload.remove=['existing']},false],
    ['near removal',p=>{p.proposal.payload.sections.near.remove=['existing']},false],
    ['future section',p=>{p.proposal.payload.sections.future={}},false],
    ['calendar mismatch',p=>{p.calendar.calendarId='other'},false],
    ['wrong zone',p=>{p.calendar.timeZone='UTC'},false],
    ['wrong boundary',p=>{p.calendar.timeMax='2026-11-10T00:00:00-03:00'},false],
    ['malformed proposed time',p=>{p.proposal.payload.sections.near.action.event.start.dateTime='invalid'},false],
    ['out of week',p=>{p.proposal.payload.sections.near.action.event.start.dateTime='2026-11-09T14:00:00-03:00';p.proposal.payload.sections.near.action.event.end.dateTime='2026-11-09T15:00:00-03:00'},false],
    ['same-minute block',p=>{p.proposal.payload.sections.near.action.event.start.dateTime='2026-11-03T14:00:10-03:00';p.proposal.payload.sections.near.action.event.end.dateTime='2026-11-03T14:00:40-03:00'},false],
    ['null existing event',p=>p.calendar.events.push(null),false],
    ['malformed existing time',p=>p.calendar.events.push({id:'existing',summary:'Class',start:{dateTime:'invalid'},end:{dateTime:'2026-11-03T15:00:00-03:00'}}),false],
    ['cancelled tombstone',p=>p.calendar.events.push({id:'deleted',status:'cancelled'}),true],
    ['tentative and free existing',p=>p.calendar.events.push({id:'existing',summary:'Class',status:'tentative',transparency:'transparent',start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}}),true],
    ['expanded recurring instance',p=>p.calendar.events.push({id:'existing',summary:'Class',recurringEventId:'series',start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}}),true],
    ['unexpanded master',p=>p.calendar.events.push({id:'existing',summary:'Class',recurrence:['RRULE:FREQ=DAILY'],start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}}),false],
    ['empty recurrence',p=>p.calendar.events.push({id:'existing',summary:'Class',recurrence:[],start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}}),false],
    ['unknown end',p=>p.calendar.events.push({id:'existing',summary:'Class',endTimeUnspecified:true,start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}}),false],
    ['empty recurring id',p=>p.calendar.events.push({id:'existing',summary:'Class',recurringEventId:'',start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}}),false],
    ['existing id collision',p=>p.calendar.events.push({id:'abcde12345',status:'cancelled'}),false],
    ['recurring proposal',p=>{p.proposal.payload.sections.near.action.event.recurrence=['RRULE:FREQ=DAILY']},false],
    ['attendee proposal',p=>{p.proposal.payload.sections.near.action.event.attendees=[{email:'fake@example.test'}]},false],
    ['cancelled proposal',p=>{p.proposal.payload.sections.near.action.event.status='cancelled'},false],
    ['free proposal',p=>{p.proposal.payload.sections.near.action.event.transparency='transparent'},false],
    ['tentative proposal',p=>{p.proposal.payload.sections.near.action.event.status='tentative'},true],
    ['invalid ownership',p=>{p.proposal.payload.sections.near.action.event.extendedProperties.private.student='bruno'},false],
    ['unsupported metadata',p=>{p.proposal.payload.sections.near.action.event.extendedProperties.private.hidden='value'},false],
    ['missing ownership',p=>{delete p.proposal.payload.sections.near.action.event.extendedProperties},false],
    ['invalid id',p=>{p.proposal.payload.sections.near.action.event.id='not-a-valid-id'},false],
    ['invalid source',p=>{p.proposal.payload.sources=['ok',{}]},false],
    ['invalid assumption',p=>{p.proposal.payload.assumptions=null},false],
  ];
  for(const [name,mutate,expected] of cases){
    const data=payload();mutate(data);
    const fetchImpl=async url=>{const u=new URL(url).pathname;const body=u.endsWith('/versions')?versions:u.endsWith('/revisions/calendar/1')?{student:'ana',kind:'calendar',version:1,payload:data.calendar}:data.proposal;return {ok:true,status:200,json:async()=>structuredClone(body)}};
    let native=true,custom=true;try{panelData(data)}catch{native=false}
    try{await readDomainView({origin:'http://127.0.0.1:4176',proposalId:id,fetchImpl})}catch{custom=false}
    assert.equal(native,expected,`native: ${name}`);assert.equal(custom,expected,`custom: ${name}`);
  }
});
