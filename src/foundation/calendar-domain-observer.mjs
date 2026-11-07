// Read-only integration spike. This module deliberately cannot perform calendar writes.
import { createHash } from 'node:crypto';

function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export async function readCalendarObservation({ provider,calendarId,timeMin,timeMax,timeZone }) {
  if(typeof calendarId!=='string'||!calendarId)throw new Error('Calendar ID required');
  const start=Date.parse(timeMin),end=Date.parse(timeMax);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>16*7*86400000)throw new Error('Invalid bounded observation interval');
  if(timeZone!==undefined){try {new Intl.DateTimeFormat('en-US',{timeZone}).format(0);}catch{throw new Error('Invalid calendar timezone');}}
  async function readEvents() {
    const events=[];let pageToken;const seen=new Set(),tokens=new Set();
    do {
      const page=await provider.listEvents(calendarId,{timeMin,timeMax,singleEvents:true,showDeleted:true,maxResults:2500,...(pageToken?{pageToken}:{})});
      if(!Array.isArray(page?.items))throw new Error('Provider returned an invalid event page');
      for(const event of page.items) {
        if(typeof event.id!=='string'||!event.id||typeof event.etag!=='string'||!event.etag||seen.has(event.id))throw new Error('Calendar observation has missing or duplicate event identity or ETag');
        seen.add(event.id);events.push(structuredClone(event));
        if(events.length>10000)throw new Error('Calendar observation exceeds event limit');
      }
      const next=page.nextPageToken;
      if(next&&(tokens.has(next)||tokens.size>=1000))throw new Error('Provider repeated or exceeded page token limit');
      if(next)tokens.add(next);
      pageToken=next;
    } while(pageToken);
    return events.sort((a,b)=>a.id.localeCompare(b.id));
  }
  const events=await readEvents();
  const data=await provider.freeBusy({timeMin,timeMax,calendarIds:[calendarId]});
  const calendar=data?.calendars?.[calendarId];
  if(!calendar||calendar.errors?.length||!Array.isArray(calendar.busy))throw new Error('Provider did not return complete availability');
  const busy=calendar.busy.map(range=>{
    const a=Date.parse(range.start),b=Date.parse(range.end);
    if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b)throw new Error('Invalid busy interval');
    return {start:range.start,end:range.end};
  }).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
  if(digest(events)!==digest(await readEvents()))throw new Error('Calendar changed while observing availability');
  const observation={schemaVersion:1,calendarId,timeMin,timeMax,...(timeZone?{timeZone}:{}),events,busy};
  observation.sha256=digest(observation);
  return observation;
}

export async function observeCalendar({provider,store,student,calendarId,timeMin,timeMax,timeZone}) {
  const expected=(await store.currentVersions(student)).calendar;
  const observation=await readCalendarObservation({provider,calendarId,timeMin,timeMax,timeZone});
  return store.addRevision(student,'calendar',observation,expected);
}
