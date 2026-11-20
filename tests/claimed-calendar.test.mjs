import test from 'node:test';
import assert from 'node:assert/strict';
import {createClaimedCalendar} from '../src/foundation/claimed-calendar.mjs';

test('a provider calendar create cannot be sent without the matching durable approval claim',async()=>{
  const calls=[];
  const calendar=createClaimedCalendar({origin:'http://127.0.0.1:4173',accessToken:'synthetic-token',getClaim:async()=>null,
    fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({})};}});
  await assert.rejects(()=>calendar.create('ana',{id:'synthetic1',summary:'Study'}),/claim/i);
  assert.equal(calls.length,0);
});

test('a changed user event is not removed and an unchanged approved event uses its ETag',async()=>{
  const event={id:'event1',summary:'Original',description:'Keep',start:{dateTime:'2026-11-02T10:00:00-03:00'},end:{dateTime:'2026-11-02T11:00:00-03:00'}};
  const claim={id:'claim1',student:'ana',kind:'approval',section:'near',decision:{kind:'approved',section:'near'},
    actions:[{actionId:'remove:event1',type:'remove',event}],steps:[{actionId:'remove:event1',status:'sent'}]};
  const calls=[];let current={...event,summary:'User edited',etag:'"version-1"'};
  const calendar=createClaimedCalendar({origin:'http://127.0.0.1:4173',accessToken:'synthetic-token',getClaim:async()=>structuredClone(claim),
    fetchImpl:async(url,options)=>{calls.push({url,options});return options.method==='GET'?{ok:true,status:200,json:async()=>current}:{ok:true,status:204};}});
  await assert.rejects(()=>calendar.remove('ana','event1'),/changed|stale/i);
  assert.equal(calls.filter(call=>call.options.method==='DELETE').length,0);
  current={...event,etag:'"version-2"'};
  await calendar.remove('ana','event1');
  const deletion=calls.find(call=>call.options.method==='DELETE');
  assert.equal(deletion.options.headers['if-match'],'"version-2"');
  assert.equal(new URL(deletion.url).pathname,'/calendar/v3/calendars/ana-calendar/events/event1');
});

test('a provider create is bound to the exact sent action and selected student',async()=>{
  const event={id:'synthetic1',summary:'Approved study'};
  const claim={id:'claim1',student:'ana',kind:'approval',section:'near',decision:{kind:'approved',section:'near'},
    actions:[{actionId:'create:synthetic1',type:'create',event}],steps:[{actionId:'create:synthetic1',status:'sent'}]};
  const calls=[];
  const calendar=createClaimedCalendar({origin:'http://127.0.0.1:4173',accessToken:'synthetic-token',getClaim:async()=>structuredClone(claim),
    fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>event};}});
  await assert.rejects(()=>calendar.create('ana',{...event,summary:'Altered'}),/differs/i);
  await assert.rejects(()=>calendar.create('bruno',event),/claim/i);
  claim.decision.section='future';
  await assert.rejects(()=>calendar.create('ana',event),/claim/i);
  claim.decision.section='near';
  assert.equal(calls.length,0);
  assert.deepEqual(await calendar.create('ana',event),event);
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0].url).pathname,'/calendar/v3/calendars/ana-calendar/events');
  assert.deepEqual(JSON.parse(calls[0].options.body),event);
});

test('an annotation patch preserves the reviewed payload and rejects an edited event',async()=>{
  const before={id:'event1',summary:'Class',description:'Existing notes',start:{dateTime:'2026-11-02T10:00:00-03:00'},end:{dateTime:'2026-11-02T11:00:00-03:00'}};
  const after={description:'Existing notes\n\n[Study Atlas]\nCategory / Categoria: classes\n[/Study Atlas]'};
  const claim={id:'claim2',student:'ana',kind:'annotation',decision:{kind:'approved'},
    actions:[{actionId:'patch:event1',type:'patch',eventId:'event1',before,after}],steps:[{actionId:'patch:event1',status:'sent'}]};
  let current={...before,description:'User edited',etag:'"v1"'};const calls=[];
  const calendar=createClaimedCalendar({origin:'http://127.0.0.1:4173',accessToken:'synthetic-token',getClaim:async()=>structuredClone(claim),
    fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>current};}});
  await assert.rejects(()=>calendar.patch('ana','event1',after),/changed|stale/i);
  assert.equal(calls.filter(call=>call.options.method==='PATCH').length,0);
  current={...before,etag:'"v2"'};
  await calendar.patch('ana','event1',after);
  const write=calls.find(call=>call.options.method==='PATCH');
  assert.equal(write.options.headers['if-match'],'"v2"');
  assert.deepEqual(JSON.parse(write.options.body),after);
});

test('calendar reads follow every provider page and reject a repeating page token',async()=>{
  let repeated=false;const calls=[];
  const calendar=createClaimedCalendar({origin:'http://127.0.0.1:4173',accessToken:'synthetic-token',getClaim:async()=>null,
    fetchImpl:async(url)=>{
      const page=new URL(url).searchParams.get('pageToken');calls.push(page);
      return {ok:true,status:200,json:async()=>page?{items:[{id:'second'}],...(repeated?{nextPageToken:'next'}:{})}:{items:[{id:'first'}],nextPageToken:'next'}};
    }});
  assert.deepEqual((await calendar.events('ana')).map(event=>event.id),['first','second']);
  assert.deepEqual(calls,[null,'next']);
  repeated=true;await assert.rejects(()=>calendar.events('ana'),/page/i);
});
