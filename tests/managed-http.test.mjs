import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createManagedHttpHandler} from '../src/foundation/managed-http.mjs';

test('managed HTTP adapter requires local same-origin JSON and forwards the selected run',async()=>{
  const calls=[];const api={approve:async(...args)=>{calls.push(args);return {applied:true};}};
  const handler=createManagedHttpHandler({api,origin:'http://localhost:4174'});
  async function request(headers,body={runId:'run-a',planId:'p',section:'near'}){
    const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',url:'/api/approve',headers:{host:'localhost:4174','content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.1'}});
    const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};await handler(req,res);return res;
  }
  assert.equal((await request({})).status,403);
  assert.equal((await request({origin:'http://evil.test'})).status,403);
  assert.equal(calls.length,0);
  assert.equal((await request({origin:'http://localhost:4174'})).status,200);
  assert.deepEqual(calls,[['run-a','p','near']]);
});
