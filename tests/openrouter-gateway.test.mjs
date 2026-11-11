import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createModelBudget} from '../src/foundation/model-budget.mjs';
import {createOpenRouterGateway} from '../src/foundation/openrouter-gateway.mjs';

test('the model gateway pins routing and accounts for the reported cost without exposing the key',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-gateway-'));let budget,server;const calls=[];
  try {
    budget=await createModelBudget({directory});
    server=createOpenRouterGateway({apiKey:'synthetic-provider-secret',accessToken:'synthetic-gateway-token',budget,
      pricing:{inputPerMillion:0.1,outputPerMillion:0.5,verifiedAt:new Date().toISOString()},
      fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({model:'deepseek/deepseek-v4.1-flash-1017',provider:'DeepSeek',choices:[],usage:{cost:0.001,prompt_tokens:100,completion_tokens:20}}),{status:200,headers:{'content-type':'application/json'}});}});
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`,{method:'POST',headers:{authorization:'Bearer synthetic-gateway-token','content-type':'application/json','x-study-role':'agent'},
      body:JSON.stringify({model:'deepseek/deepseek-v4.1-flash-1017',messages:[{role:'user',content:'Synthetic exercise'}],max_tokens:256})});
    assert.equal(response.status,200);const body=await response.text();
    assert(!body.includes('synthetic-provider-secret'));
    assert.equal(calls.length,1);assert.equal(calls[0].url,'https://openrouter.ai/api/v1/chat/completions');
    assert.deepEqual(JSON.parse(calls[0].options.body).provider,{only:['DeepSeek'],allow_fallbacks:false,require_parameters:true});
    assert.equal((await budget.summary()).observedUsd,0.001);
  } finally {if(server)await new Promise(resolve=>server.close(resolve));await budget?.close();await rm(directory,{recursive:true,force:true});}
});

test('streamed model output remains available while its final cost is recorded',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-gateway-stream-'));let budget,server;
  try {
    budget=await createModelBudget({directory});
    const encoder=new TextEncoder();
    server=createOpenRouterGateway({apiKey:'synthetic-provider-secret',accessToken:'synthetic-gateway-token',budget,
      pricing:{inputPerMillion:0.1,outputPerMillion:0.5,verifiedAt:new Date().toISOString()},
      fetchImpl:async()=>new Response(new ReadableStream({start(controller){
        for(const part of ['data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n','data: {"usage":{"cost":0.002,','"prompt_tokens":100,"completion_tokens":30}}\n\ndata: [DONE]\n\n'])controller.enqueue(encoder.encode(part));
        controller.close();
      }}),{status:200,headers:{'content-type':'text/event-stream'}})});
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`,{method:'POST',headers:{authorization:'Bearer synthetic-gateway-token','content-type':'application/json'},
      body:JSON.stringify({model:'deepseek/deepseek-v4.1-flash-1017',messages:[{role:'user',content:'Synthetic'}],max_tokens:256,stream:true})});
    assert.equal(response.status,200);const text=await response.text();
    assert.match(text,/Hello/);assert.match(text,/\[DONE\]/);
    assert.equal((await budget.summary()).observedUsd,0.002);
  } finally {if(server)await new Promise(resolve=>server.close(resolve));await budget?.close();await rm(directory,{recursive:true,force:true});}
});

test('unauthorized requests never reach the provider and unknown usage blocks further calls',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-gateway-guard-'));let budget,server,calls=0;
  try {
    budget=await createModelBudget({directory});
    server=createOpenRouterGateway({apiKey:'synthetic-provider-secret',accessToken:'synthetic-gateway-token',budget,
      pricing:{inputPerMillion:0.1,outputPerMillion:0.5,verifiedAt:new Date().toISOString()},
      fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[],usage:{}}),{status:200,headers:{'content-type':'application/json'}});}});
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${server.address().port}/v1/chat/completions`;
    const send=(token,model)=>fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'Synthetic'}],max_tokens:256})});
    assert.equal((await send('wrong','deepseek/deepseek-v4.1-flash-1017')).status,401);
    assert.equal((await send('synthetic-gateway-token','other-model')).status,400);
    assert.equal(calls,0);
    assert.equal((await send('synthetic-gateway-token','deepseek/deepseek-v4.1-flash-1017')).status,200);
    assert.equal((await budget.summary()).unknownCount,1);
    assert.equal((await send('synthetic-gateway-token','deepseek/deepseek-v4.1-flash-1017')).status,409);
    assert.equal(calls,1);
  } finally {if(server)await new Promise(resolve=>server.close(resolve));await budget?.close();await rm(directory,{recursive:true,force:true});}
});

test('a truncated stream has unknown usage and does not permit a retry',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-gateway-truncated-'));let budget,server,calls=0;
  try {
    budget=await createModelBudget({directory});
    server=createOpenRouterGateway({apiKey:'synthetic-provider-secret',accessToken:'synthetic-gateway-token',budget,
      pricing:{inputPerMillion:0.1,outputPerMillion:0.5,verifiedAt:new Date().toISOString()},
      fetchImpl:async()=>{calls++;return new Response('data: {"choices":[]}\n\n',{status:200,headers:{'content-type':'text/event-stream'}});}});
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    const send=()=>fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`,{method:'POST',headers:{authorization:'Bearer synthetic-gateway-token','content-type':'application/json'},body:JSON.stringify({model:'deepseek/deepseek-v4.1-flash-1017',messages:[{role:'user',content:'Synthetic'}],max_tokens:256,stream:true})});
    try {const response=await send();await response.text();} catch {/* The incomplete stream is intentionally terminated. */}
    assert.equal((await budget.summary()).unknownCount,1);
    assert.equal((await send()).status,409);assert.equal(calls,1);
  } finally {if(server)await new Promise(resolve=>server.close(resolve));await budget?.close();await rm(directory,{recursive:true,force:true});}
});
