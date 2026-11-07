import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainStore } from '../src/domain-store.mjs';
import { observeCalendar } from '../src/foundation/calendar-domain-observer.mjs';

const args={student:'ana',calendarId:'ana-calendar',timeMin:'2026-11-02T00:00:00-03:00',timeMax:'2026-11-09T00:00:00-03:00'};
const event=id=>({id,etag:`etag-${id}`,summary:id});
test('observer follows pagination, includes ETags and availability, and records a version',async()=>{
  const store=new DomainStore();
  const provider={async listEvents(id,options){return options.pageToken?{items:[event('b')]}:{items:[event('a')],nextPageToken:'next'};},async freeBusy(){return {calendars:{'ana-calendar':{busy:[{start:'2026-11-02T10:00:00-03:00',end:'2026-11-02T11:00:00-03:00'}]}}};}};
  try {
    const result=await observeCalendar({...args,store,provider});
    assert.equal(result.version,1);assert.deepEqual(result.payload.events.map(x=>x.id),['a','b']);
    assert.match(result.payload.sha256,/^[a-f0-9]{64}$/);assert.equal(result.payload.busy.length,1);
  } finally {store.close();}
});
test('incomplete or changed observations never become the current revision',async()=>{
  const store=new DomainStore();
  try {
    const bad={async listEvents(){return {items:[{id:'missing-etag'}]};},async freeBusy(){throw new Error('unexpected');}};
    await assert.rejects(()=>observeCalendar({...args,store,provider:bad}),/identity or ETag/);
    const badBusy={async listEvents(){return {items:[]};},async freeBusy(){return {calendars:{'ana-calendar':{errors:[{reason:'unavailable'}]}}};}};
    await assert.rejects(()=>observeCalendar({...args,store,provider:badBusy}),/availability/);
    const cycle={async listEvents(){return {items:[],nextPageToken:'same'};},async freeBusy(){throw new Error('unexpected');}};
    await assert.rejects(()=>observeCalendar({...args,store,provider:cycle}),/page token/);
    let written=false;
    const changed={async listEvents(){if(!written){store.addRevision('ana','calendar',{other:true},0);written=true;}return {items:[]};},async freeBusy(){return {calendars:{'ana-calendar':{busy:[]}}};}};
    await assert.rejects(()=>observeCalendar({...args,store,provider:changed}),/STALE/);
    assert.deepEqual(store.getRevision('ana','calendar',1).payload,{other:true});
  } finally {store.close();}
});
