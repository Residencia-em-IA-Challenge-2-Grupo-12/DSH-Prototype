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
