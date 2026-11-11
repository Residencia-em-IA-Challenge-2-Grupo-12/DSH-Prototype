import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT} from '../src/core.mjs';
import {createModelBudget} from '../src/foundation/model-budget.mjs';
import {createOpenRouterGateway} from '../src/foundation/openrouter-gateway.mjs';
import {createGatewayRoute} from '../src/foundation/dsh-model-route.mjs';
import {StudySession} from '../src/sdk-session.mjs';

test('actual DSH uses only the isolated gateway and records a simulated provider charge',{timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-dsh-route-'));let budget,server,child;const upstream=[];
  try {
    budget=await createModelBudget({directory:join(directory,'budget')});
    server=createOpenRouterGateway({apiKey:'synthetic-upstream-secret',accessToken:'a'.repeat(64),budget,
      pricing:{inputPerMillion:0.3,outputPerMillion:1.2,verifiedAt:new Date().toISOString()},
      fetchImpl:async(url,options)=>{
        upstream.push({url,body:JSON.parse(options.body),authorization:options.headers.authorization});
        const base={id:'chatcmpl-synthetic',object:'chat.completion.chunk',created:1,model:'deepseek/deepseek-v4.1-flash-1017'};
        const chunks=[{...base,choices:[{index:0,delta:{role:'assistant',content:'Synthetic gateway response.'},finish_reason:null}]},
          {...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110,cost:0.002}}];
        return new Response(chunks.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
      }});
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    const route=createGatewayRoute({baseURL:`http://127.0.0.1:${server.address().port}/v1`,accessToken:'a'.repeat(64)});
    child=spawn(process.execPath,[`${ROOT}/node_modules/@deepseek-ai/dsh/lib/bin.js`,'--profile','sdk',
      '--patch',`${ROOT}/dsh-study.patch.yml`,'--patch',route.patch],{cwd:ROOT,
      env:{PATH:process.env.PATH,DSH_HOME:join(directory,'dsh'),STUDY_ATLAS_RUNTIME_DIR:join(directory,'runtime'),
        ...route.env,DSH_PRIMARY_RUNTIME:'',DSH_PERMISSION_MODE:'read-only'},stdio:['pipe','pipe','pipe']});
    let stderr='';child.stderr.on('data',c=>{stderr=(stderr+String(c)).slice(-4000);});
    const pending=new Map(),events=[];
    createInterface({input:child.stdout}).on('line',line=>{let frame;try{frame=JSON.parse(line);}catch{return;}
      if(frame.method==='session.event')events.push(frame.params?.event);
      if(frame.id!==undefined&&!frame.method&&pending.has(frame.id)){pending.get(frame.id)(frame);pending.delete(frame.id);}
      if(frame.method==='approval/request')child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:frame.id,result:{outcome:'rejected'}})+'\n');
    });
    const rpc=(id,method,params)=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timed out; ${stderr}`));},12000);
      pending.set(id,frame=>{clearTimeout(timer);resolve(frame);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
    const init=await rpc(1,'initialize',{cwd:directory,provider:route.provider,model:route.model,capabilities:{userQuestions:true},approvalRequests:true});
    assert(!init.error,JSON.stringify(init.error));
    const prompt=await rpc(2,'session/prompt',{sessionId:'synthetic-gateway-test',contentBlocks:[{type:'text',text:'Reply briefly to this synthetic test.'}]});
    assert(!prompt.error,JSON.stringify(prompt.error));
    const wait=await rpc(3,'session/wait',{sessionId:'synthetic-gateway-test'});
    assert(!wait.error,JSON.stringify(wait.error));
    assert(events.some(event=>JSON.stringify(event).includes('Synthetic gateway response.')),`DSH did not surface the gateway response: ${stderr}`);
    assert.equal(upstream.length,1);assert.equal(upstream[0].url,'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(upstream[0].authorization,'Bearer synthetic-upstream-secret');
    assert.deepEqual(upstream[0].body.provider,{only:['deepseek'],allow_fallbacks:false,require_parameters:true});
    assert.equal((await budget.summary()).observedUsd,0.002);
  } finally {
    if(child){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
    if(server)await new Promise(resolve=>server.close(resolve));await budget?.close();await rm(directory,{recursive:true,force:true});
  }
});

test('the application session wrapper can use the DSH gateway route without provider credentials',{timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-session-route-'));let budget,server,session,calls=0;
  const previous=process.env.STUDY_ATLAS_RUNTIME_DIR;
  try {
    process.env.STUDY_ATLAS_RUNTIME_DIR=directory;
    await mkdir(join(directory,'workspaces','ana'),{recursive:true});
    budget=await createModelBudget({directory:join(directory,'budget')});
    server=createOpenRouterGateway({apiKey:'synthetic-provider-key',accessToken:'b'.repeat(64),budget,
      pricing:{inputPerMillion:0.3,outputPerMillion:1.2,verifiedAt:new Date().toISOString()},
      fetchImpl:async()=>{
        calls++;const base={id:'chatcmpl-synthetic',object:'chat.completion.chunk',created:1,model:'deepseek/deepseek-v4.1-flash-1017'};
        const frames=[{...base,choices:[{index:0,delta:{role:'assistant',content:'Application gateway reply.'},finish_reason:null}]},
          {...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30,cost:0.001}}];
        return new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join('')+'data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
      }});
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    session=new StudySession('ana',{gateway:{baseURL:`http://127.0.0.1:${server.address().port}/v1`,accessToken:'b'.repeat(64)}});
    await session.prompt('Say hello in this synthetic test.');
    const deadline=Date.now()+12000;
    while(session.snapshot().busy&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(session.snapshot().busy,false);
    assert.equal(session.snapshot().error,null);
    assert(session.snapshot().messages.some(message=>message.type==='assistant'&&message.text.includes('Application gateway reply.')));
    assert.equal(calls,1);assert.equal((await budget.summary()).observedUsd,0.001);
  } finally {
    if(session?.child){const exited=new Promise(resolve=>session.child.once('exit',resolve));session.stop();await exited;}
    if(server)await new Promise(resolve=>server.close(resolve));await budget?.close();
    if(previous===undefined)delete process.env.STUDY_ATLAS_RUNTIME_DIR;else process.env.STUDY_ATLAS_RUNTIME_DIR=previous;
    await rm(directory,{recursive:true,force:true});
  }
});
