import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { DomainStore } from '../src/domain-store.mjs';
import { CalendarpitApi } from '../src/foundation/calendarpit-api.mjs';
import { observeCalendar } from '../src/foundation/calendar-domain-observer.mjs';
import { applyApprovedCreate } from '../src/foundation/calendar-approved-create.mjs';
import { DomainRequestError } from '../src/foundation/domain-http-observer-client.mjs';

const timeMin='2026-11-02T00:00:00-03:00',timeMax='2026-11-09T00:00:00-03:00';
const action={type:'create',calendarId:'ana-calendar',event:{id:'abcde0123456',summary:'Study',description:'Approved note',start:{dateTime:'2026-11-02T13:00:00-03:00'},end:{dateTime:'2026-11-02T14:00:00-03:00'},extendedProperties:{private:{studyDemo:'true',student:'ana'}}}};
let nextPort=41000+(process.pid%10000);
function fixture({failAfterWrite=false,failReadAfterWrite=false,insertConflict=false,editOther=false,beforePost,filename=':memory:',timeZone}={}) {
  const store=new DomainStore(filename);let events=[],writes=0;
  const origin=`http://127.0.0.1:${nextPort++}`;
  const reply=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)});
  async function fetchImpl(url,options) {
    const path=new URL(url).pathname;
    if(path.endsWith('/freeBusy'))return reply({calendars:{'ana-calendar':{busy:events.filter(e=>e.status!=='cancelled'&&e.start.dateTime&&e.end.dateTime).map(e=>({start:e.start.dateTime,end:e.end.dateTime}))}}});
    if(path.endsWith('/events')&&options.method==='GET'){
      if(failReadAfterWrite&&writes)throw Error('simulated read failure');
      return reply({items:events});
    }
    if(path.endsWith('/events')&&options.method==='POST'){
      if(beforePost)await beforePost();
      writes++;const event=JSON.parse(options.body);
      if(insertConflict)events.push({id:'other',etag:'external',summary:'Concurrent event',start:event.start,end:event.end});
      if(editOther&&events.length)events[0]={...events[0],etag:'changed',summary:'Edited during write'};
      events.push({...event,etag:'new-etag'});
      if(failAfterWrite)return reply({},500);
      return reply(events.at(-1));
    }
    throw Error('Unexpected provider request');
  }
  const domain={currentVersions:s=>store.currentVersions(s),addRevision:(...a)=>store.addRevision(...a),proposal:(...a)=>store.getProposal(...a),calendarRevision:(s,v)=>store.getRevision(s,'calendar',v),claim:(...a)=>{
    try{return store.claimApplication(...a);}catch(error){
      const safe=/^STALE: (context|evidence|calendar) revision changed$/.test(error.message)||['Section not approved','Action does not match approved proposal','Application already claimed','Unknown proposal'].includes(error.message);
      throw new DomainRequestError(409,error.message,{claimRejected:safe});
    }
  },application:(...a)=>store.getApplication(...a),applications:s=>store.listApplications(s),finish:(...a)=>store.finishApplication(...a)};
  const client=new CalendarpitApi({origin,accessToken:'synthetic',fetchImpl});
  const params={domain,student:'ana',section:'near',action:structuredClone(action),origin,accessToken:'synthetic',fetchImpl};
  const lockPath=join(tmpdir(),'study-calendar-bridge-locks-v1',createHash('sha256').update(origin).digest('hex'));
  return {store,domain,client,params,timeZone,events:()=>events,writes:()=>writes,add:event=>events.push(event),cleanup:()=>rmSync(lockPath,{recursive:true,force:true})};
}
async function prepare(f,{approve=true}={}) {
  f.store.addRevision('ana','context',{student:'synthetic'},0);f.store.addRevision('ana','evidence',{sources:[]},0);
  await observeCalendar({provider:f.client,store:f.domain,student:'ana',calendarId:'ana-calendar',timeMin,timeMax,...(f.timeZone?{timeZone:f.timeZone}:{})});
  const proposal=f.store.createProposal('ana',f.store.currentVersions('ana'),{sections:{near:{action}}});
  if(approve)f.store.decide('ana',proposal.id,'near','approve');
  f.params.proposalId=proposal.id;
}
test('only the exact approved action creates once and records observed resulting state',async()=>{
  const f=fixture();try {
    await prepare(f);
    const changed=structuredClone(action);changed.event.summary='Unapproved change';
    await assert.rejects(()=>applyApprovedCreate({...f.params,action:changed}),/Action does not match/);
    assert.equal(f.writes(),0);
    const result=await applyApprovedCreate(f.params);
    assert.equal(result.state,'completed');assert.equal(result.result.createdEventId,action.event.id);
    assert.equal(result.result.actualState.events[0].description,'Approved note');
    assert.equal(f.store.currentVersions('ana').calendar,2);assert.equal(f.writes(),1);
    await assert.rejects(()=>applyApprovedCreate(f.params),/STALE|already claimed/);
    assert.equal(f.writes(),1);
  } finally {f.store.close();f.cleanup();}
});
test('unapproved and changed calendars prevent writes',async()=>{
  const f=fixture();try {
    await prepare(f,{approve:false});await assert.rejects(()=>applyApprovedCreate(f.params),/not approved/);assert.equal(f.writes(),0);
    f.store.decide('ana',f.params.proposalId,'near','approve');
    f.add({id:'other',etag:'e2',start:{dateTime:'2026-11-02T13:15:00-03:00'},end:{dateTime:'2026-11-02T13:45:00-03:00'}});
    const result=await applyApprovedCreate(f.params);
    assert.equal(result.state,'failed');assert.match(result.result.error,/STALE/);assert.equal(f.writes(),0);
    assert(result.result.actualState.events.some(e=>e.id==='other'));
  } finally {f.store.close();f.cleanup();}
});
test('provider error after a write remains unknown, records actual state and blocks retries',async()=>{
  const f=fixture({failAfterWrite:true});try {
    await prepare(f);const result=await applyApprovedCreate(f.params);
    assert.equal(result.state,'unknown');assert.equal(f.writes(),1);
    assert(result.result.actualState.events.some(e=>e.id===action.event.id));
    await assert.rejects(()=>applyApprovedCreate(f.params),/needs reconciliation/);
    assert.throws(()=>f.store.addRevision('ana','context',{new:true},1),/needs reconciliation/);
  } finally {f.store.close();f.cleanup();}
});
test('simultaneous attempts cannot both claim the same decision',async()=>{
  const f=fixture();try {
    await prepare(f);const results=await Promise.allSettled([applyApprovedCreate(f.params),applyApprovedCreate(f.params)]);
    assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.state==='completed').length,1);
    assert.equal(results.filter(x=>x.status==='rejected').length,1);assert.equal(f.writes(),1);
  } finally {f.store.close();f.cleanup();}
});
test('a conflict inserted after the pre-write check is flagged for review',async()=>{
  const f=fixture({insertConflict:true});try {
    await prepare(f);const result=await applyApprovedCreate(f.params);
    assert.equal(result.state,'review');assert.equal(result.result.requiresReview,true);
    assert.deepEqual(result.result.conflictingEventIds,['other']);
    assert.throws(()=>f.store.addRevision('ana','context',{new:true},1),/needs reconciliation/);
    await assert.rejects(()=>applyApprovedCreate(f.params),/needs reconciliation/);
  } finally {f.store.close();f.cleanup();}
});
test('an unrelated edit during the write requires review and blocks new claims',async()=>{
  const f=fixture({editOther:true});try {
    f.add({id:'other',etag:'before',summary:'Other',start:{dateTime:'2026-11-03T13:00:00-03:00'},end:{dateTime:'2026-11-03T14:00:00-03:00'}});
    await prepare(f);const result=await applyApprovedCreate(f.params);
    assert.equal(result.state,'review');assert.equal(result.result.unexpectedCalendarChange,true);
    assert.deepEqual(result.result.conflictingEventIds,[]);
    assert.throws(()=>f.store.addRevision('ana','calendar',{},2),/needs reconciliation/);
  } finally {f.store.close();f.cleanup();}
});
test('all-day dates use the explicit calendar zone and exclusive end',async()=>{
  for(const [from,to,zone,expected] of [['2026-11-02','2026-11-03','America/Sao_Paulo','review'],['2026-11-03','2026-11-04','America/Sao_Paulo','completed'],['2026-11-07','2026-11-08','America/Sao_Paulo','completed'],['2026-11-02','2026-11-03',undefined,'review']]){
    const f=fixture({timeZone:zone});try {
      f.add({id:'all-day',etag:'initial',start:{date:from},end:{date:to}});
      await prepare(f);const result=await applyApprovedCreate(f.params);
      assert.equal(result.state,expected);
      if(!zone)assert.deepEqual(result.result.unresolvedEventIds,['all-day']);
      else if(expected==='review')assert.deepEqual(result.result.conflictingEventIds,['all-day']);
      else assert.deepEqual(result.result.unresolvedEventIds,[]);
    } finally {f.store.close();f.cleanup();}
  }
});
test('a lost claim response is discoverable and keeps the instance locked',async()=>{
  const f=fixture();try {
    await prepare(f);const original=f.domain.claim;
    f.domain.claim=(...args)=>{original(...args);throw Error('lost response');};
    await assert.rejects(()=>applyApprovedCreate(f.params),/Claim outcome unknown/);
    assert.equal(f.store.listApplications('ana')[0].state,'pending');
    assert.equal(f.writes(),0);
    await assert.rejects(()=>applyApprovedCreate(f.params),/needs reconciliation/);
  } finally {f.store.close();f.cleanup();}
});
test('unknown or review state locks the calendar for a separate domain store',async()=>{
  const first=fixture({failAfterWrite:true}),second=fixture();try {
    await prepare(first);await prepare(second);
    const result=await applyApprovedCreate(first.params);assert.equal(result.state,'unknown');
    second.params.origin=first.params.origin;
    await assert.rejects(()=>applyApprovedCreate(second.params),/needs reconciliation/);
    assert.equal(second.writes(),0);
  } finally {first.store.close();second.store.close();first.cleanup();second.cleanup();}
});
test('different domain stores cannot write concurrently to one simulator instance',async()=>{
  let enter,release;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
  const first=fixture({beforePost:async()=>{enter();await gate;}}),second=fixture();
  try {
    await prepare(first);await prepare(second);second.params.origin=first.params.origin;
    const running=applyApprovedCreate(first.params);await entered;
    await assert.rejects(()=>applyApprovedCreate(second.params),/application or needs reconciliation/);
    release();assert.equal((await running).state,'completed');assert.equal(first.writes(),1);assert.equal(second.writes(),0);
  } finally {release();first.store.close();second.store.close();first.cleanup();second.cleanup();}
});
test('a different unresolved proposal keeps the instance locked after claim rejection',async()=>{
  const first=fixture(),second=fixture();try {
    await prepare(first);await prepare(second);
    const other=first.store.createProposal('ana',first.store.currentVersions('ana'),{sections:{near:{action}}});
    first.store.decide('ana',other.id,'near','approve');
    first.store.claimApplication('ana',first.params.proposalId,'near',action);
    await assert.rejects(()=>applyApprovedCreate({...first.params,proposalId:other.id}),/reconciliation/);
    second.params.origin=first.params.origin;
    await assert.rejects(()=>applyApprovedCreate(second.params),/needs reconciliation/);
  } finally {first.store.close();second.store.close();first.cleanup();second.cleanup();}
});
test('transport timeout before a delayed claim commit keeps a separate store blocked',async()=>{
  const first=fixture(),second=fixture();let release,lateCommit;
  const gate=new Promise(resolve=>release=resolve);
  try {
    await prepare(first);await prepare(second);second.params.origin=first.params.origin;
    const original=first.domain.claim;
    first.domain.claim=(...args)=>{lateCommit=gate.then(()=>original(...args));throw new Error('Transport timeout');};
    await assert.rejects(()=>applyApprovedCreate(first.params),/Claim outcome unknown/);
    assert.equal(first.store.listApplications('ana').length,0,'the timed-out claim has not committed yet');
    await assert.rejects(()=>applyApprovedCreate(second.params),/needs reconciliation/);
    assert.equal(second.writes(),0);
    release();const claim=await lateCommit;
    assert.equal(claim.state,'pending');
    assert.equal(first.store.listApplications('ana')[0].id,claim.id);
    await assert.rejects(()=>applyApprovedCreate(second.params),/needs reconciliation/);
  } finally {release();if(lateCommit)await lateCommit.catch(()=>{});first.store.close();second.store.close();first.cleanup();second.cleanup();}
});
test('large observations fail before sending; failed persistence stays unknown after sending',async()=>{
  const large=fixture();try {
    large.add({id:'large',etag:'initial',summary:'x'.repeat(61000),start:{dateTime:'2026-11-03T13:00:00-03:00'},end:{dateTime:'2026-11-03T14:00:00-03:00'}});
    await prepare(large);const result=await applyApprovedCreate(large.params);
    assert.equal(result.state,'failed');assert.match(result.result.error,/too large/);assert.equal(large.writes(),0);
  } finally {large.store.close();large.cleanup();}
  const persist=fixture();try {
    await prepare(persist);const finish=persist.domain.finish;let attempts=0;
    persist.domain.finish=(...args)=>{if(attempts++<2)throw Error('HTTP 413');return finish(...args);};
    const result=await applyApprovedCreate(persist.params);
    assert.equal(result.state,'unknown');assert.equal(result.result.actualState,null);
    assert.equal(result.result.observationPersistence,'unavailable');
    assert(result.unpersistedObservation.events.some(e=>e.id===action.event.id));
    assert.equal(persist.store.getApplication('ana',result.id).state,'unknown');
  } finally {persist.store.close();persist.cleanup();}
});
test('unreadable actual state after a provider request remains unknown',async()=>{
  const f=fixture({failReadAfterWrite:true});try {
    await prepare(f);const result=await applyApprovedCreate(f.params);
    assert.equal(result.state,'unknown');assert.equal(result.result.actualState,null);
    assert.equal(f.writes(),1);assert.equal(f.store.getApplication('ana',result.id).state,'unknown');
  } finally {f.store.close();f.cleanup();}
});
test('a pending claim survives process restart and prevents unreviewed retries',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'study-claim-')),filename=join(directory,'store.sqlite');
  const f=fixture({filename});
  try {
    await prepare(f);const claim=f.store.claimApplication('ana',f.params.proposalId,'near',action);
    f.store.close();const recovered=new DomainStore(filename);
    try {
      assert.equal(recovered.getApplication('ana',claim.id).state,'pending');
      assert.throws(()=>recovered.claimApplication('ana',f.params.proposalId,'near',action),/needs reconciliation/);
      assert.throws(()=>recovered.addRevision('ana','calendar',{unreviewed:true},1),/needs reconciliation/);
    } finally {recovered.close();}
  } finally {f.cleanup();rmSync(directory,{recursive:true,force:true});}
});
test('store rejects falsely completed conflicting outcomes',async()=>{
  const f=fixture();try {
    await prepare(f);const claim=f.store.claimApplication('ana',f.params.proposalId,'near',action);
    assert.throws(()=>f.store.finishApplication('ana',claim.id,'completed',{actualState:{},requiresReview:true,conflictingEventIds:['other']}),/requires reconciliation/);
    assert.equal(f.store.getApplication('ana',claim.id).state,'pending');
  } finally {f.store.close();f.cleanup();}
});
test('schema 2 application claims survive migration to schema 3',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'study-claim-migration-')),filename=join(directory,'store.sqlite');
  const f=fixture({filename});try {
    await prepare(f);const claim=f.store.claimApplication('ana',f.params.proposalId,'near',action);
    f.store.db.exec(`BEGIN; ALTER TABLE applications RENAME TO applications_v3;
      CREATE TABLE applications (id TEXT PRIMARY KEY,student TEXT NOT NULL,proposal_id TEXT NOT NULL,
      section TEXT NOT NULL CHECK(section IN ('near','future')),action TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','completed','failed','unknown')),result TEXT,created_at TEXT NOT NULL,finished_at TEXT,
      FOREIGN KEY(student,proposal_id) REFERENCES proposals(student,id),UNIQUE(proposal_id,section));
      INSERT INTO applications SELECT * FROM applications_v3;DROP TABLE applications_v3;PRAGMA user_version=2;COMMIT;`);
    f.store.close();const migrated=new DomainStore(filename);
    try {assert.equal(migrated.db.prepare('PRAGMA user_version').get().user_version,3);assert.equal(migrated.getApplication('ana',claim.id).state,'pending');
      assert.throws(()=>migrated.addRevision('ana','context',{},1),/needs reconciliation/);
    } finally {migrated.close();}
  } finally {f.cleanup();rmSync(directory,{recursive:true,force:true});}
});
test('independent connections cannot both claim the same approved action',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'study-claim-race-')),filename=join(directory,'store.sqlite');
  const f=fixture({filename});
  try {
    await prepare(f);f.store.close();
    const url=new URL('../src/domain-store.mjs',import.meta.url).href;
    const source=`const {parentPort,workerData}=require('node:worker_threads');
      import(workerData.url).then(({DomainStore})=>{const s=new DomainStore(workerData.filename);
        try{s.claimApplication('ana',workerData.proposal,'near',workerData.action);parentPort.postMessage('ok');}
        catch(e){parentPort.postMessage(e.message);}finally{s.close();}}).catch(e=>{throw e;});`;
    function run(){return new Promise((resolve,reject)=>{
      const worker=new Worker(source,{eval:true,workerData:{url,filename,proposal:f.params.proposalId,action}});
      worker.once('message',resolve);worker.once('error',reject);
    });}
    const results=await Promise.all([run(),run()]);
    assert.equal(results.filter(x=>x==='ok').length,1);
    assert.equal(results.filter(x=>/pending or needs reconciliation|already claimed/.test(x)).length,1);
  } finally {f.cleanup();rmSync(directory,{recursive:true,force:true});}
});
