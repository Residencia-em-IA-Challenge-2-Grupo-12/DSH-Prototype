import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createDemo } from '../experiments/sdk-ui/runtime.mjs';
import { createHandler } from '../experiments/sdk-ui/server.mjs';

function fakeRequest(handler,{method='GET',url='/',body,host='127.0.0.1:4444',remote='127.0.0.1',origin}={}) {
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  req.method=method;req.url=url;req.headers={host,...(body===undefined?{}:{'content-type':'application/json'}),...(origin?{origin}:{})};req.socket={remoteAddress:remote};
  return new Promise((resolve,reject)=>{
    const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(value){resolve({status:this.status,headers:this.headers,body:value?.toString()})}};
    Promise.resolve(handler(req,res)).catch(reject);
  });
}

test('trusted review is separate; rejecting and approving synthetic drafts have distinct outcomes',async()=>{
  const {controller,agentSurface,debug}=await createDemo();try {
    assert.deepEqual(Object.keys(agentSurface).sort(),['draftOneBlock','readCalendar','readContext']);
    assert.equal(typeof agentSurface.approve,'undefined');assert.equal(typeof agentSurface.reject,'undefined');
    const initial=controller.state(),count=debug.getEventCount();assert(initial.events.length>0);
    const draft=await controller.propose();assert(draft.proposal);assert.equal(debug.getEventCount(),count);
    await assert.rejects(()=>controller.review('wrong','approve'),/no longer pending/);
    await assert.rejects(()=>controller.review(draft.proposal.id,'yes'),/Invalid review/);
    assert.equal(debug.getEventCount(),count);
    const rejected=await controller.review(draft.proposal.id,'reject');assert.equal(rejected.outcome,'rejected');assert.equal(debug.getEventCount(),count);
    const next=await controller.propose();const id=next.proposal.payload.sections.near.action.event.id;
    const approved=await controller.review(next.proposal.id,'approve');
    assert.equal(approved.outcome,'completed');assert.equal(debug.getEventCount(),count+1);assert(approved.events.some(event=>event.id===id));
  } finally {controller.close();}
});

test('same-origin local handler exposes assets and guards review request shape',async()=>{
  const {controller,debug}=await createDemo();try {
    const handler=createHandler(controller,()=>4444),count=debug.getEventCount();
    assert.equal((await fakeRequest(handler,{host:'example.test:4444'})).status,403);
    assert.equal((await fakeRequest(handler,{remote:'192.168.0.2'})).status,403);
    assert.equal((await fakeRequest(handler,{method:'POST',url:'/api/plan',body:{},origin:'http://example.test'})).status,403);
    const html=await fakeRequest(handler);assert.equal(html.status,200);assert.match(html.body,/No language model or agent is running/);
    const before=JSON.parse((await fakeRequest(handler,{url:'/api/state'})).body);assert.equal(before.proposal,null);
    assert.equal((await fakeRequest(handler,{method:'POST',url:'/api/review',body:{choice:'approve',proposalId:'unknown'}})).status,400);
    const drafted=JSON.parse((await fakeRequest(handler,{method:'POST',url:'/api/plan',body:{}})).body);
    const wrong=await fakeRequest(handler,{method:'POST',url:'/api/review',body:{choice:'approve',proposalId:drafted.proposal.id,unexpected:true}});
    assert.equal(wrong.status,400);assert.equal(debug.getEventCount(),count);
    const rejected=await fakeRequest(handler,{method:'POST',url:'/api/review',body:{choice:'reject',proposalId:drafted.proposal.id}});
    assert.equal(JSON.parse(rejected.body).outcome,'rejected');assert.equal(debug.getEventCount(),count);
    assert.equal((await fakeRequest(handler,{url:'/../../etc/passwd'})).status,404);
  } finally {controller.close();}
});

test('uncertain synthetic provider result blocks an unreviewed retry',async()=>{
  const {controller,debug}=await createDemo({failAfterWrite:true});try {
    const original=debug.getEventCount(),draft=await controller.propose();
    const createdId=draft.proposal.payload.sections.near.action.event.id;
    const result=await controller.review(draft.proposal.id,'approve');
    assert.equal(result.outcome,'unknown');assert.equal(debug.getEventCount(),original+1);
    assert.equal(result.calendarStatus,'observed-after-attempt');
    assert(result.events.some(event=>event.id===createdId),'show the actual observed result after an uncertain write');
    const wire=JSON.parse((await fakeRequest(createHandler(controller,()=>4444),{url:'/api/state'})).body);
    assert.equal(wire.calendarStatus,'observed-after-attempt');assert(wire.events.some(event=>event.id===createdId));
    await assert.rejects(()=>controller.propose(),/needs reconciliation/);
    assert.equal(debug.getEventCount(),original+1);
  } finally {
    controller.close();
    // The isolated fake calendar ceases to exist with this test; only its own
    // synthetic lock may be removed after the assertions above.
    rmSync(debug.lockPath,{recursive:true,force:true});
  }
});


test('unreadable actual state marks the prior calendar stale and blocks an unreviewed retry',async()=>{
  const {controller,debug}=await createDemo({failAfterWrite:true,failReadsAfterWrite:true});try {
    const original=debug.getEventCount(),draft=await controller.propose();
    const createdId=draft.proposal.payload.sections.near.action.event.id;
    const result=await controller.review(draft.proposal.id,'approve');
    assert.equal(result.outcome,'unknown');assert.equal(debug.getEventCount(),original+1);
    assert.equal(result.calendarStatus,'previous-stale');
    assert(!result.events.some(event=>event.id===createdId),'only the explicitly stale previous snapshot is available');
    const wire=JSON.parse((await fakeRequest(createHandler(controller,()=>4444),{url:'/api/state'})).body);
    assert.equal(wire.calendarStatus,'previous-stale');
    await assert.rejects(()=>controller.propose(),/needs reconciliation/);
    assert.equal(debug.getEventCount(),original+1);
  } finally {controller.close();rmSync(debug.lockPath,{recursive:true,force:true});}
});


test('calendar display labels after-attempt and stale snapshots in the actual client script',async()=>{
  const source=await readFile(new URL('../experiments/sdk-ui/app.js',import.meta.url),'utf8');
  for(const [calendarStatus,expected] of [
    ['observed-after-attempt',/observed after the attempt/],
    ['previous-stale',/previous snapshot, which may be stale/]
  ]){
    const nodes=new Map();
    function element(){return {style:{},children:[],textContent:'',hidden:false,append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},addEventListener(){}};}
    const document={querySelector(key){if(!nodes.has(key))nodes.set(key,element());return nodes.get(key)},querySelectorAll(){return []},createElement(){return element()}};
    const payload={calendarStatus,events:[],proposal:null,outcome:'unknown'};
    const fetch=async()=>({ok:true,json:async()=>payload});
    vm.runInNewContext(source,{document,fetch,Intl,Date});
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(nodes.get('#calendar-state').textContent,expected);
    assert.equal(nodes.get('#draft').hidden,true);
  }
});

test('client hides cancelled tombstones and labels tentative/free events and proposed details',async()=>{
  const source=await readFile(new URL('../experiments/sdk-ui/app.js',import.meta.url),'utf8');
  const nodes=new Map();
  function element(){return {style:{},children:[],textContent:'',hidden:false,append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},addEventListener(){}};}
  const document={querySelector(key){if(!nodes.has(key))nodes.set(key,element());return nodes.get(key)},querySelectorAll(){return []},createElement(){return element()}};
  const start={dateTime:'2026-11-03T14:00:00-03:00'},end={dateTime:'2026-11-03T15:00:00-03:00'};
  const event={id:'abcde12345',summary:'Synthetic study',description:'Study planning demo.',status:'tentative',start,end};
  const payload={calendarStatus:'shared-point-in-time',readOnly:true,events:[{id:'deleted',status:'cancelled'},{id:'existing',summary:'Flexible class',status:'tentative',transparency:'transparent',start,end}],proposal:{payload:{sections:{near:{action:{event}}}}},outcome:null};
  const fetch=async()=>({ok:true,json:async()=>payload});
  vm.runInNewContext(source,{document,fetch,Intl,Date});await new Promise(resolve=>setImmediate(resolve));
  const rendered=JSON.stringify(nodes.get('#calendar'));
  assert.match(rendered,/Existing · Flexible class · tentative · free/);assert.match(rendered,/Proposed · Synthetic study/);assert.doesNotMatch(rendered,/deleted/);
  assert.equal(nodes.get('#event-status').textContent,'tentative');assert.equal(nodes.get('#description').textContent,'Study planning demo.');
});

test('both calendar pages explain that empty space is not confirmed availability',async()=>{
  for(const name of ['index.html','compare-index.html']){
    const html=await readFile(new URL('../experiments/sdk-ui/'+name,import.meta.url),'utf8');
    assert.match(html,/Empty grid space is not confirmed availability/);
  }
});
