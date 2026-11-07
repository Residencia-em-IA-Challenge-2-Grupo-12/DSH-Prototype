import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainStore } from '../src/domain-store.mjs';
import { DomainRequestError } from '../src/foundation/domain-http-observer-client.mjs';
import { CalendarpitApi } from '../src/foundation/calendarpit-api.mjs';
import { createSyntheticConsumer } from '../src/foundation/sdk-app-consumer.mjs';

let nextPort=43000+(process.pid%10000);
async function fixture({failAfterWrite=false}={}) {
  const store=new DomainStore(),origin=`http://127.0.0.1:${nextPort++}`;let events=[],writes=0;
  const response=(data,status=200)=>({status,ok:status>=200&&status<300,json:async()=>structuredClone(data)});
  async function fetchImpl(url,options){
    const p=new URL(url).pathname;
    if(p.endsWith('/events')&&options.method==='GET')return response({items:events});
    if(p.endsWith('/freeBusy'))return response({calendars:{'ana-calendar':{busy:events.map(e=>({start:e.start.dateTime,end:e.end.dateTime}))}}});
    if(p.endsWith('/events')&&options.method==='POST'){writes++;const event=JSON.parse(options.body);events.push({...event,etag:'etag-created'});return failAfterWrite?response({},500):response(events.at(-1));}
    throw Error('Unexpected provider request');
  }
  const domain={
    currentVersions:s=>store.currentVersions(s),addRevision:(...a)=>store.addRevision(...a),
    proposal:(...a)=>store.getProposal(...a),calendarRevision:(s,v)=>store.getRevision(s,'calendar',v),
    claim:(...args)=>{try{return store.claimApplication(...args);}catch(e){const safe=/^STALE: (context|evidence|calendar) revision changed$/.test(e.message)||['Section not approved','Action does not match approved proposal','Application already claimed','Unknown proposal'].includes(e.message);throw new DomainRequestError(409,e.message,{claimRejected:safe});}},
    application:(...a)=>store.getApplication(...a),applications:s=>store.listApplications(s),finish:(...a)=>store.finishApplication(...a),
    request:(s,path,body)=>{
      const parts=path.split('/');
      if(parts[0]==='revisions'&&parts.length===2)return store.addRevision(s,parts[1],body.payload,body.expectedVersion);
      if(parts[0]==='revisions'&&parts.length===3)return store.getRevision(s,parts[1],Number(parts[2]));
      if(parts[0]==='proposals'&&parts.length===1)return store.createProposal(s,body.versions,body.payload);
      if(parts[0]==='proposals'&&parts.length===3&&parts[2]==='decisions')return store.decide(s,parts[1],body.section,body.choice);
      throw Error('Unexpected domain request');
    }
  };
  const provider=new CalendarpitApi({origin,accessToken:'synthetic',fetchImpl});
  const profile=JSON.parse(await readFile(new URL('../fixtures/students/ana/courses.json',import.meta.url),'utf8'));
  const consumer=await createSyntheticConsumer({domain,provider,student:'ana',profile,origin,accessToken:'synthetic',fetchImpl});
  const lock=join(tmpdir(),'study-calendar-bridge-locks-v1',createHash('sha256').update(origin).digest('hex'));
  return {...consumer,domain,profile,store,writes:()=>writes,events:()=>events,add:event=>events.push(event),close:()=>{store.close();rmSync(lock,{recursive:true,force:true});}};
}

test('read and draft surface contains no review or calendar write method',async()=>{
  const f=await fixture();try {
    assert.deepEqual(Object.keys(f.agent).sort(),['draftOneBlock','readCalendar','readContext']);
    assert.equal((await f.agent.readContext()).synthetic,true);
    await assert.rejects(()=>f.agent.draftOneBlock(),/Read the synthetic calendar first/);
    await f.agent.readCalendar();const proposal=await f.agent.draftOneBlock();
    assert.equal(f.writes(),0);
    await assert.rejects(()=>f.human.approveAndApply(proposal.id,'yes'),/Explicit APPROVE/);
    await f.human.reject(proposal.id);assert.equal(f.writes(),0);
    await assert.rejects(()=>f.human.approveAndApply(proposal.id,'APPROVE'),/already decided/);
    assert.equal(f.writes(),0);
  } finally {f.close();}
});
test('explicit review applies only the exact proposed synthetic event',async()=>{
  const f=await fixture();try {
    await f.agent.readCalendar();const proposal=await f.agent.draftOneBlock(),event=proposal.payload.sections.near.action.event;
    const result=await f.human.approveAndApply(proposal.id,'APPROVE');
    assert.equal(result.state,'completed');assert.equal(f.writes(),1);
    assert.equal(result.result.createdEventId,event.id);assert.equal(f.events()[0].description,event.description);
    assert.equal(f.store.currentVersions('ana').calendar,2);
  } finally {f.close();}
});
test('calendar changes after the draft stop an approved application',async()=>{
  const f=await fixture();try {
    await f.agent.readCalendar();const proposal=await f.agent.draftOneBlock();
    f.add({id:'external',etag:'etag-external',summary:'User edit',start:{dateTime:'2026-11-03T08:00:00-03:00'},end:{dateTime:'2026-11-03T09:00:00-03:00'}});
    const result=await f.human.approveAndApply(proposal.id,'APPROVE');
    assert.equal(result.state,'failed');assert.match(result.result.error,/STALE/);assert.equal(f.writes(),0);
  } finally {f.close();}
});
test('uncertain write is persisted and cannot be retried',async()=>{
  const f=await fixture({failAfterWrite:true});try {
    await f.agent.readCalendar();const proposal=await f.agent.draftOneBlock();
    const result=await f.human.approveAndApply(proposal.id,'APPROVE');
    assert.equal(result.state,'unknown');assert.equal(f.writes(),1);
    assert.equal(f.store.listApplications('ana')[0].state,'unknown');
    await assert.rejects(()=>f.human.approveAndApply(proposal.id,'APPROVE'),/needs reconciliation/);
  } finally {f.close();}
});
test('draft uses the recorded context revision, not caller mutation or an older profile',async()=>{
  const f=await fixture();try {
    await f.agent.readCalendar();
    const original=structuredClone(f.profile);
    f.profile.studyWindows=[];
    const first=await f.agent.draftOneBlock();
    assert.equal(first.versions.context,1);
    assert(first.payload.sections.near.action.event);

    const revised=structuredClone(original);
    revised.studyWindows=[{weekday:3,start:'14:00',end:'16:00'}];
    revised.courses[0].source='courses/revised.md';
    f.store.addRevision('ana','context',{synthetic:true,profile:revised},1);
    const next=await f.agent.draftOneBlock();
    assert.equal(next.versions.context,2);
    assert(next.payload.sections.near.action.event.start.dateTime.startsWith('2026-11-04T'));
    assert(next.payload.sources.includes('courses/revised.md'));

    revised.studyWindows=[];
    f.store.addRevision('ana','context',{synthetic:true,profile:revised},2);
    await assert.rejects(()=>f.agent.draftOneBlock(),/No block is available/);
    assert.equal(f.writes(),0);
  } finally {f.close();}
});
test('create-only draft preserves existing owned study blocks as busy',async()=>{
  const f=await fixture();try {
    const existing={id:'ownedstudy',etag:'etag-existing',summary:'Existing study',
      start:{dateTime:'2026-11-02T14:00:00-03:00'},end:{dateTime:'2026-11-02T15:00:00-03:00'},
      extendedProperties:{private:{studyDemo:'true',student:'ana'}}};
    f.add(existing);
    await f.agent.readCalendar();
    const proposal=await f.agent.draftOneBlock(),event=proposal.payload.sections.near.action.event;
    assert(!(Date.parse(event.start.dateTime)<Date.parse(existing.end.dateTime)&&Date.parse(existing.start.dateTime)<Date.parse(event.end.dateTime)));
    assert.equal(f.writes(),0);
  } finally {f.close();}
});
test('a context change during drafting prevents a stale proposal',async()=>{
  const f=await fixture();try {
    await f.agent.readCalendar();
    const readCalendar=f.domain.calendarRevision;
    f.domain.calendarRevision=(student,version)=>{
      const changed=structuredClone(f.profile);changed.studyWindows=[];
      f.store.addRevision(student,'context',{synthetic:true,profile:changed},1);
      return readCalendar(student,version);
    };
    await assert.rejects(()=>f.agent.draftOneBlock(),/STALE: context revision changed/);
    assert.equal(f.writes(),0);
  } finally {f.close();}
});
