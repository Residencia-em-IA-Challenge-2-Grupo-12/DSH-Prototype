// Synthetic, single-create integration experiment. No general calendar editing.
import { CalendarpitApi } from './calendarpit-api.mjs';
import { readCalendarObservation } from './calendar-domain-observer.mjs';
import { DomainRequestError } from './domain-http-observer-client.mjs';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
// This common host directory coordinates bridge processes that share the same
// temporary filesystem. A private container /tmp must not be used as a shared lock.
const LOCK_ROOT=path.join(tmpdir(),'study-calendar-bridge-locks-v1');
async function lockOrigin(origin,metadata) {
  const url=new URL(origin);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('A canonical 127.0.0.1 synthetic origin is required');
  await fs.mkdir(LOCK_ROOT,{recursive:true,mode:0o700});
  const root=await fs.lstat(LOCK_ROOT);
  if(!root.isDirectory()||root.isSymbolicLink()||(root.mode&0o077)!==0||(process.getuid&&root.uid!==process.getuid()))throw new Error('Calendar lock directory is not private');
  const lock=path.join(LOCK_ROOT,createHash('sha256').update(url.origin).digest('hex'));
  try {await fs.mkdir(lock,{mode:0o700});}
  catch(error) {if(error.code==='EEXIST')throw new Error('Calendar instance already has an application or needs reconciliation');throw error;}
  // A crash before metadata is saved leaves a blocked lock, not an unsafe retry.
  await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify(metadata),{mode:0o600,flag:'wx'});
  return async()=>{await fs.rm(lock,{recursive:true,force:true});};
}
function validateAction(student,action) {
  if(action?.type!=='create'||typeof action.calendarId!=='string'||!action.calendarId)throw new Error('Only a calendar create action is supported');
  const event=action.event;
  if(!event||typeof event!=='object'||Array.isArray(event)||!/^[a-v0-9]{5,128}$/.test(event.id||''))throw new Error('A stable Google-compatible event ID is required');
  if(Object.keys(action).some(key=>!['type','calendarId','event'].includes(key))||Object.keys(event).some(key=>!['id','summary','description','start','end','status','transparency','extendedProperties'].includes(key)))throw new Error('Unsupported create fields');
  if(typeof event.summary!=='string'||!event.summary.trim()||(event.description!==undefined&&typeof event.description!=='string'))throw new Error('Valid event summary and description required');
  if(event.extendedProperties?.private?.studyDemo!=='true'||event.extendedProperties?.private?.student!==student)throw new Error('Synthetic ownership marker required');
  if(event.status==='cancelled'||event.transparency==='transparent')throw new Error('A visible busy event is required');
  for(const value of [event.start?.dateTime,event.end?.dateTime])
    if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Event times need explicit offsets');
  for(const value of [event.start,event.end])if(Object.keys(value).some(key=>!['dateTime','timeZone'].includes(key)))throw new Error('Unsupported event time fields');
  if(Date.parse(event.start.dateTime)>=Date.parse(event.end.dateTime))throw new Error('Invalid event interval');
}
function includesApproved(actual,expected,key='') {
  if(key==='dateTime')return Date.parse(actual)===Date.parse(expected);
  if(expected&&typeof expected==='object'&&!Array.isArray(expected))return actual&&typeof actual==='object'&&Object.keys(expected).every(k=>includesApproved(actual[k],expected[k],k));
  return same(actual,expected);
}
function overlap(a,b,c,d) {return a<d&&c<b;}
function validDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function localDate(millis,timeZone) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(millis));
  const fields=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${fields.year}-${fields.month}-${fields.day}`;
}
function conflictingEvents(actual,event) {
  const start=Date.parse(event.start.dateTime),end=Date.parse(event.end.dateTime);
  const ids=[],unresolved=[];
  for(const other of actual.events){
    if(other.id===event.id||other.status==='cancelled'||other.transparency==='transparent')continue;
    if(other.start?.date||other.end?.date) {
      if(!actual.timeZone||!validDate(other.start?.date)||!validDate(other.end?.date)||other.start.date>=other.end.date){unresolved.push(other.id);continue;}
      let first,last;
      try {first=localDate(start,actual.timeZone);last=localDate(end-1,actual.timeZone);}catch{unresolved.push(other.id);continue;}
      if(last>=other.start.date&&first<other.end.date)ids.push(other.id);
      continue;
    }
    const otherStart=Date.parse(other.start?.dateTime),otherEnd=Date.parse(other.end?.dateTime);
    if(!Number.isFinite(otherStart)||!Number.isFinite(otherEnd)){unresolved.push(other.id);continue;}
    if(overlap(start,end,otherStart,otherEnd))ids.push(other.id);
  }
  return {ids,unresolved};
}

/** domain is a trusted DomainObservationClient. Stored claims block concurrent local revisions.
 * An in-flight claim remains pending across crashes; pending and unknown must be reconciled manually.
 */
export async function applyApprovedCreate({domain,student,proposalId,section,action,origin,accessToken,fetchImpl}) {
  action=structuredClone(action);
  validateAction(student,action);
  const unlock=await lockOrigin(origin,{student,proposalId,section});
  // The domain service atomically checks current versions, approval, exact action and single use.
  let claim;
  try {claim=await domain.claim(student,proposalId,section,action);}
  catch(error) {
    // A transport failure can precede a late server commit. A list read is not
    // proof that this in-flight claim will never commit. Release only after a
    // trusted service response explicitly confirms the claim was rolled back.
    if(error instanceof DomainRequestError&&error.claimRejected===true){await unlock();throw error;}
    throw new Error('Claim outcome unknown; calendar lock retained for reconciliation',{cause:error});
  }
  let sent=false,actualState=null;
  let provider;
  let observationOptions;
  try {
    provider=new CalendarpitApi({origin,accessToken,...(fetchImpl?{fetchImpl}:{}),
      authorizeWrite:async(candidate,approval)=>{
        const current=await domain.application(student,claim.id);
        return current.state==='pending'&&approval.claimId===claim.id&&same(current.action,candidate);
      }});
    const proposal=await domain.proposal(student,proposalId);
    const baseline=(await domain.calendarRevision(student,proposal.versions.calendar)).payload;
    if(baseline.calendarId!==action.calendarId)throw new Error('Calendar does not match approved observation');
    observationOptions={provider,calendarId:baseline.calendarId,timeMin:baseline.timeMin,timeMax:baseline.timeMax,...(baseline.timeZone?{timeZone:baseline.timeZone}:{})};
    const start=Date.parse(action.event.start.dateTime),end=Date.parse(action.event.end.dateTime);
    if(start<Date.parse(baseline.timeMin)||end>Date.parse(baseline.timeMax))throw new Error('Event is outside observed interval');
    actualState=await readCalendarObservation(observationOptions);
    if(actualState.sha256!==baseline.sha256)throw new Error('STALE: calendar changed after proposal');
    if(actualState.busy.some(b=>overlap(start,end,Date.parse(b.start),Date.parse(b.end))))throw new Error('Calendar time is no longer available');
    if(actualState.events.some(e=>e.id===action.event.id))throw new Error('Stable event ID already exists');
    // Leave room for provider-added fields and the enclosing result. Unexpected
    // growth can still exceed the cap and is handled as unknown below.
    const estimate=Buffer.byteLength(JSON.stringify({state:'completed',result:{actualState,createdEventId:action.event.id,conflictingEventIds:[],unresolvedEventIds:[],requiresReview:false}}))+2*Buffer.byteLength(JSON.stringify(action.event))+4096;
    if(estimate>64*1024)throw new Error('Observation is too large for safe result persistence');
    sent=true;
    const created=await provider.createApprovedEvent({calendarId:action.calendarId,event:action.event,approval:{claimId:claim.id}});
    actualState=await readCalendarObservation(observationOptions);
    const actual=actualState.events.find(e=>e.id===action.event.id);
    if(!actual||actual.id!==created.id||!includesApproved(actual,action.event))throw new Error('Created event could not be verified in actual calendar state');
    const conflicts=conflictingEvents(actualState,action.event);
    const withoutCreated=actualState.events.filter(event=>event.id!==action.event.id);
    const unexpectedCalendarChange=!same(baseline.events,withoutCreated);
    const result={actualState,createdEventId:actual.id,conflictingEventIds:conflicts.ids,unresolvedEventIds:conflicts.unresolved,unexpectedCalendarChange,requiresReview:!!(conflicts.ids.length||conflicts.unresolved.length||unexpectedCalendarChange)};
    const finished=await domain.finish(student,claim.id,result.requiresReview?'review':'completed',result);
    if(finished.state==='completed')await unlock();
    return finished;
  } catch(error) {
    if(sent&&observationOptions) {
      try {actualState=await readCalendarObservation(observationOptions);}catch{actualState=null;}
    }
    const state=sent?'unknown':'failed';
    const result={error:error.message,providerRequestAttempted:sent,actualState};
    try {
      const finished=await domain.finish(student,claim.id,state,result);
      if(finished.state==='failed')await unlock();
      return finished;
    } catch {
      // Never represent a truncated snapshot as complete. Persist an explicit
      // unknown (or failed before sending) without the oversized observation.
      const minimal={error:'Full observation could not be persisted; reconciliation required',providerRequestAttempted:sent,actualState:null,observationPersistence:'unavailable'};
      try {
        const finished=await domain.finish(student,claim.id,state,minimal);
        if(finished.state==='failed')await unlock();
        return {...finished,unpersistedObservation:actualState};
      } catch {return {id:claim.id,student,proposalId,section,state:'unknown',result:minimal,unpersistedObservation:actualState};}
    }
  }
}
