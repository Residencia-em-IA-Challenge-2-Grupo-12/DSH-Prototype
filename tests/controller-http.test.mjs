import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startControllerRpc,createControllerClient} from '../src/foundation/controller-rpc.mjs';
import {createManagedHttpHandler} from '../src/foundation/managed-http.mjs';

test('local HTTP reaches only the trusted controller operations through private IPC',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'study-controller-')),calls=[];let rpc,web;
  try{
    rpc=await startControllerRpc({socketPath:join(dir,'control.sock'),api:{runStatus:async()=>({run:{id:'run-a'},available:true}),approve:async(...args)=>{calls.push(args);return {applied:true};}}});
    let handle;web=http.createServer((req,res)=>handle(req,res));await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${web.address().port}`;handle=createManagedHttpHandler({origin,api:createControllerClient({socketPath:join(dir,'control.sock')})});
    const status=await fetch(origin+'/api/run');assert.equal((await status.json()).run.id,'run-a');
    const denied=await fetch(origin+'/api/approve',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(denied.status,403);
    const approved=await fetch(origin+'/api/approve',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({runId:'run-a',planId:'p',section:'near'})});assert.equal(approved.status,200);assert.deepEqual(calls,[['run-a','p','near']]);
    assert.equal((await fetch(origin+'/api/reset',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'})).status,404);
  }finally{if(web)await new Promise(resolve=>web.close(resolve));await rpc?.close();await rm(dir,{recursive:true,force:true});}
});

test('controller timeout returns an unconfirmed mutation while explicit rejection remains definite',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'study-controller-'));
  const socketPath=join(directory,'control.sock');
  let rpc,web,finishApproval,reportApplied;
  const releaseApproval=new Promise(resolve=>{finishApproval=resolve;});
  const approvalApplied=new Promise(resolve=>{reportApplied=resolve;});
  const request=http.request;
  t.mock.method(http,'request',function(options,...args){
    return request.call(this,options.socketPath===socketPath?{...options,timeout:500}:options,...args);
  });
  try{
    rpc=await startControllerRpc({socketPath,api:{async approve(_runId,_planId,section){
      if(section==='future')throw Error('Proposal is stale');
      await releaseApproval;
      reportApplied();
      return {written:['synthetic-event']};
    }}});
    let handler;
    web=http.createServer((req,res)=>handler(req,res));
    await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${web.address().port}`;
    handler=createManagedHttpHandler({origin,api:createControllerClient({socketPath})});
    const approve=section=>fetch(origin+'/api/approve',{
      method:'POST',headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({runId:'run-a',planId:'proposal',section})
    });
    const rejection=await approve('future');
    assert.equal(rejection.status,400);
    assert.deepEqual(await rejection.json(),{error:'Proposal is stale'});

    const timeout=await approve('near');
    assert.equal(timeout.status,502);
    assert.equal((await timeout.json()).outcome,'unconfirmed');
    finishApproval();
    await approvalApplied;
  }finally{
    finishApproval();
    if(web)await new Promise(resolve=>web.close(resolve));
    await rpc?.close();
    await rm(directory,{recursive:true,force:true});
  }
});
