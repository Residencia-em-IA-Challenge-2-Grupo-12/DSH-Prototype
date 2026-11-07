import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import Registry from '@deepseek-ai/dsh-typert-registry';
import Access from '@deepseek-ai/dsh-api-remote-access';
import Gateway from '@deepseek-ai/dsh-api-gateway';
import {createDomainService} from '../src/domain-service.mjs';
import {CalendarHost} from '../src/foundation/dsh-calendar-host.mjs';

test('actual DSH host gateway reads common domain state and exposes stale status, not writes',async t=>{
  const service=createDomainService(); const address=await service.listen(0);
  t.after(()=>service.close());
  const origin=`http://127.0.0.1:${address.port}`;
  const post=async(path,body)=>{let r=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,201);return r.json();};
  const root='/v1/students/ana';
  for(const kind of ['context','evidence','calendar'])await post(root+'/revisions/'+kind,{expectedVersion:0,payload:kind==='calendar'?{events:[{id:'e1',summary:'Synthetic class'}]}:{synthetic:true}});
  const proposal=await post(root+'/proposals',{versions:{context:1,evidence:1,calendar:1},payload:{near:[{id:'b1',summary:'Proposed study'}],future:[]}});
  const dsh=new Context(); const fibers=[];
  t.after(async()=>{for(const f of fibers.reverse())await f.dispose();});
  fibers.push(await dsh.plugin(Registry));fibers.push(await dsh.plugin(Access));fibers.push(await dsh.plugin(Gateway));
  fibers.push(await dsh.plugin(CalendarHost,{origin,students:['ana']}));
  const peer={principal:{kind:'owner'},signal:new AbortController().signal};
  const req={namespace:'calendarSpike',method:'read',args:{student:'ana',proposalId:proposal.id},peer};
  let data=await dsh.typertGateway.invoke(req);
  assert.equal(data.calendar.events[0].id,'e1');assert.equal(data.proposal.payload.near[0].id,'b1');assert.equal(data.stale,false);
  await post(root+'/revisions/context',{expectedVersion:1,payload:{changed:true}});
  data=await dsh.typertGateway.invoke(req);assert.equal(data.stale,true);
  await assert.rejects(dsh.typertGateway.invoke({...req,args:{...req.args,student:'../other'}}),/Unknown synthetic student/);
  await assert.rejects(dsh.typertGateway.invoke({...req,method:'approve'}),e=>e.code==='gateway/invocation-unavailable');
  await assert.rejects(dsh.typertGateway.invoke({...req,peer:{principal:{kind:'untrusted',id:'x'},signal:new AbortController().signal}}),e=>e.code==='remote-access/denied');
});


test('a domain revision that changes during a read rejects the mixed snapshot',async t=>{
  const service=createDomainService();const address=await service.listen(0);t.after(()=>service.close());
  const origin=`http://127.0.0.1:${address.port}`, prefix='/v1/students/ana';
  const realFetch=globalThis.fetch;
  const post=async(path,body)=>{const r=await realFetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,201);return r.json();};
  for(const kind of ['context','evidence','calendar'])await post(prefix+'/revisions/'+kind,{expectedVersion:0,payload:{synthetic:true}});
  const proposal=await post(prefix+'/proposals',{versions:{context:1,evidence:1,calendar:1},payload:{near:[]}});
  let changed=false;
  const fetchImpl=async(url,options)=>{const response=await realFetch(url,options);if(url.endsWith('/revisions/calendar/1')&&!changed){changed=true;await post(prefix+'/revisions/context',{expectedVersion:1,payload:{changed:true}});}return response;};
  const host=new Context(),fibers=[];t.after(async()=>{for(const f of fibers.reverse())await f.dispose();});
  fibers.push(await host.plugin(Registry));fibers.push(await host.plugin(Access));fibers.push(await host.plugin(Gateway));fibers.push(await host.plugin(CalendarHost,{origin,students:['ana'],fetchImpl}));
  const peer={principal:{kind:'owner'},signal:new AbortController().signal};
  await assert.rejects(host.typertGateway.invoke({namespace:'calendarSpike',method:'read',args:{student:'ana',proposalId:proposal.id},peer}),/Domain state changed during read/);
});

test('host requires string synthetic identities and complete revision identities',async()=>{
  const origin='http://127.0.0.1:4176';
  const values={context:1,evidence:1,calendar:1};
  const calendar={student:'ana',kind:'calendar',version:1,payload:{events:[]}};
  const proposal={id:'proposal-1',student:'ana',versions:{...values},payload:{near:[]}};
  const response=value=>({ok:true,json:async()=>structuredClone(value)});
  function makeHost({current=values,latest=current,calendarRecord=calendar,proposalRecord=proposal}={}) {
    let versionReads=0;
    const fetchImpl=async url=>{
      if(url.endsWith('/versions'))return response(++versionReads===1?current:latest);
      if(url.endsWith('/revisions/calendar/1'))return response(calendarRecord);
      if(url.endsWith('/proposals/proposal-1'))return response(proposalRecord);
      throw Error('Unexpected test request');
    };
    return new CalendarHost(new Context(),{origin,students:['ana'],fetchImpl});
  }
  for(const students of [[42],[{toString:()=> 'ana'}],['ana',null]]) {
    assert.throws(()=>new CalendarHost(new Context(),{origin,students}),/allowlist/);
  }
  await assert.rejects(()=>makeHost().read(42,'proposal-1'),/Unknown synthetic student/);
  for(const versions of [{calendar:1},{...values,evidence:0},{...values,context:'1'},{...values,calendar:Number.MAX_SAFE_INTEGER+1}]) {
    await assert.rejects(()=>makeHost({current:versions}).read('ana','proposal-1'),/Complete domain revisions/);
    await assert.rejects(()=>makeHost({latest:versions}).read('ana','proposal-1'),/Complete domain revisions/);
    await assert.rejects(()=>makeHost({proposalRecord:{...proposal,versions}}).read('ana','proposal-1'),/proposal identity or revisions/);
  }
  for(const changed of [{...calendar,student:'other'},{...calendar,version:2},{...calendar,kind:'context'}])
    await assert.rejects(()=>makeHost({calendarRecord:changed}).read('ana','proposal-1'),/calendar revision identity/);
  for(const changed of [{...proposal,student:'other'},{...proposal,id:'other'}])
    await assert.rejects(()=>makeHost({proposalRecord:changed}).read('ana','proposal-1'),/proposal identity or revisions/);
  const valid=await makeHost({latest:{calendar:1,context:1,evidence:1}}).read('ana','proposal-1');
  assert.equal(valid.stale,false,'equivalent version maps may have different key order');
  const older=await makeHost({current:{...values,context:2},latest:{...values,context:2}}).read('ana','proposal-1');
  assert.equal(older.stale,true);
});
