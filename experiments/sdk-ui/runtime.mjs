// Synthetic comparison harness. An actual agent must not receive this trusted
// controller, its local review service, or unrestricted host network access.
import { readFile } from 'node:fs/promises';
import { createHash, randomInt } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainStore } from '../../src/domain-store.mjs';
import { DomainRequestError } from '../../src/foundation/domain-http-observer-client.mjs';
import { CalendarpitApi } from '../../src/foundation/calendarpit-api.mjs';
import { createSyntheticConsumer } from '../../src/foundation/sdk-app-consumer.mjs';

export async function createDemo({failAfterWrite=false,failReadsAfterWrite=false}={}) {
  const store=new DomainStore();
  const fixture=JSON.parse(await readFile(new URL('../../fixtures/calendars/ana.json',import.meta.url),'utf8'));
  const profile=JSON.parse(await readFile(new URL('../../fixtures/students/ana/courses.json',import.meta.url),'utf8'));
  const origin=`http://127.0.0.1:${randomInt(20000,60000)}`,accessToken='fictional-ephemeral';
  let events=fixture.events.map(event=>({...structuredClone(event),etag:`"fixture-${event.id}"`})), wrote=false;
  const response=(data,status=200)=>({status,ok:status>=200&&status<300,json:async()=>structuredClone(data)});
  async function fetchImpl(raw,options){
    const url=new URL(raw);
    if(url.origin!==origin||!url.pathname.startsWith('/calendar/v3/'))throw Error('Unexpected provider request');
    if(options.headers.authorization!==`Bearer ${accessToken}`)return response({},401);
    if(wrote&&failReadsAfterWrite&&options.method==='GET')return response({},503);
    if(url.pathname==='/calendar/v3/calendars/ana-calendar/events'&&options.method==='GET') {
      const min=Date.parse(url.searchParams.get('timeMin')),max=Date.parse(url.searchParams.get('timeMax'));
      return response({items:events.filter(e=>Date.parse(e.start?.dateTime)<max&&Date.parse(e.end?.dateTime)>min)});
    }
    if(url.pathname==='/calendar/v3/freeBusy'&&options.method==='POST') {
      const body=JSON.parse(options.body),min=Date.parse(body.timeMin),max=Date.parse(body.timeMax);
      const busy=events.filter(e=>e.status!=='cancelled'&&e.transparency!=='transparent'&&Date.parse(e.start?.dateTime)<max&&Date.parse(e.end?.dateTime)>min)
        .map(e=>({start:e.start.dateTime,end:e.end.dateTime}));
      return response({calendars:{'ana-calendar':{busy}}});
    }
    if(url.pathname==='/calendar/v3/calendars/ana-calendar/events'&&options.method==='POST') {
      const event=JSON.parse(options.body);
      if(events.some(e=>e.id===event.id))return response({},409);
      const created={...event,etag:`"created-${event.id}"`};events.push(created);wrote=true;return failAfterWrite?response({},500):response(created);
    }
    throw Error('Unexpected provider request');
  }
  const domain={
    currentVersions:s=>store.currentVersions(s),addRevision:(...a)=>store.addRevision(...a),
    proposal:(...a)=>store.getProposal(...a),calendarRevision:(s,v)=>store.getRevision(s,'calendar',v),
    claim:(...args)=>{try{return store.claimApplication(...args);}catch(e){const safe=/^STALE: (context|evidence|calendar) revision changed$/.test(e.message)||['Section not approved','Action does not match approved proposal','Application already claimed','Unknown proposal'].includes(e.message);throw new DomainRequestError(409,e.message,{claimRejected:safe});}},
    application:(...a)=>store.getApplication(...a),applications:s=>store.listApplications(s),finish:(...a)=>store.finishApplication(...a),
    request:(s,p,body)=>{const parts=p.split('/');
      if(parts[0]==='revisions'&&parts.length===2)return store.addRevision(s,parts[1],body.payload,body.expectedVersion);
      if(parts[0]==='revisions'&&parts.length===3)return store.getRevision(s,parts[1],Number(parts[2]));
      if(parts[0]==='proposals'&&parts.length===1)return store.createProposal(s,body.versions,body.payload);
      if(parts[0]==='proposals'&&parts.length===3&&parts[2]==='decisions')return store.decide(s,parts[1],body.section,body.choice);
      throw Error('Unexpected domain request');}
  };
  const provider=new CalendarpitApi({origin,accessToken,fetchImpl});
  const consumer=await createSyntheticConsumer({domain,provider,student:'ana',profile,origin,accessToken,fetchImpl});
  let observation=await consumer.agent.readCalendar(), pending=null, outcome=null, busy=false, calendarStatus='observed-before-review';
  function state(){return {events:structuredClone(observation.payload.events),calendarStatus,proposal:structuredClone(pending),outcome,simulationDate:'2026-11-02',timeZone:'America/Sao_Paulo'};}
  async function exclusive(fn){if(busy)throw Error('Another operation is in progress');busy=true;try{return await fn();}finally{busy=false;}}
  const controller=Object.freeze({
    // This is an application host operation, not an agent tool.
    state,
    propose:()=>exclusive(async()=>{
      if(pending)throw Error('Review the current proposal first');
      if(['unknown','review','pending'].includes(outcome))throw Error('The previous application needs reconciliation before another proposal');
      observation=await consumer.agent.readCalendar();calendarStatus='observed-before-review';
      pending=await consumer.agent.draftOneBlock();outcome=null;return state();
    }),
    review:(id,choice)=>exclusive(async()=>{
      if(!pending||pending.id!==id)throw Error('Proposal is no longer pending');
      if(!['approve','reject'].includes(choice))throw Error('Invalid review choice');
      if(choice==='reject') {await consumer.human.reject(id);outcome='rejected';pending=null;return state();}
      let result;
      try {result=await consumer.human.approveAndApply(id,'APPROVE');}
      catch {pending=null;outcome='unknown';calendarStatus='previous-stale';throw Error('The decision or application outcome is uncertain; current calendar state is unavailable');}
      outcome=result.state;pending=null;
      // The bridge may have observed the actual provider state even when the
      // write is uncertain or needs review. It is a point-in-time observation,
      // not a new domain revision or proof against later external changes.
      const actual=result.result?.actualState??result.unpersistedObservation;
      if(Array.isArray(actual?.events)){observation={payload:structuredClone(actual)};calendarStatus='observed-after-attempt';}
      else calendarStatus='previous-stale';
      return state();
    }),
    close:()=>{store.close();},
  });
  // No reviewer or raw domain/provider handle is ever included in the agent surface.
  const agentSurface=consumer.agent;
  return {controller,agentSurface,debug:{getEventCount:()=>events.length,origin,lockPath:join(tmpdir(),'study-calendar-bridge-locks-v1',createHash('sha256').update(origin).digest('hex'))}};
}
