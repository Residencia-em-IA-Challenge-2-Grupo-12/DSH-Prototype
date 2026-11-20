import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT,initializeScenario} from '../src/core.mjs';
import {createModelBudget} from '../src/foundation/model-budget.mjs';
import {createOpenRouterGateway} from '../src/foundation/openrouter-gateway.mjs';
import {createGatewayRoute} from '../src/foundation/dsh-model-route.mjs';
import {StudySession} from '../src/sdk-session.mjs';
import {createStudyBoundary} from '../src/foundation/study-boundary.mjs';
import {startStudyBroker} from '../src/foundation/study-broker.mjs';

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

test('actual DSH uses the broker-only calendar tool through a simulated model',{timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-dsh-broker-'));let budget,server,session,broker,calls=0,writes=0,diagnostic='';const seen=[];
  const previous=process.env.STUDY_ATLAS_RUNTIME_DIR;
  try {
    process.env.STUDY_ATLAS_RUNTIME_DIR=directory;
    const fixture=JSON.parse(await readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
    const calendar={events:async()=>structuredClone(fixture.events),create:async()=>{writes++;throw new Error('unexpected write');}};
    await initializeScenario(calendar,'ana');
    const ipc=join(directory,'ipc');await mkdir(ipc,{mode:0o700});const socketPath=join(ipc,'agent.sock');
    broker=await startStudyBroker({socketPath,boundary:createStudyBoundary({student:'ana',calendar})});
    budget=await createModelBudget({directory:join(directory,'budget')});
    server=createOpenRouterGateway({apiKey:'synthetic-provider-key',accessToken:'c'.repeat(64),budget,
      pricing:{inputPerMillion:0.3,outputPerMillion:1.2,verifiedAt:new Date().toISOString()},
      fetchImpl:async(_url,options)=>{
        calls++;const request=JSON.parse(options.body);
        seen.push({tools:request.tools?.map(tool=>tool.function?.name),messages:request.messages?.map(message=>({role:message.role,hasDate:JSON.stringify(message).includes('2026-11-02')}))});
        const base={id:'synthetic-'+calls,object:'chat.completion.chunk',created:1,model:'deepseek/deepseek-v4.1-flash-1017'};
        let frames;
        if(calls===1){
          assert(request.tools?.some(tool=>tool.function?.name==='mcp__study__list_calendar'),'calendar tool absent from DSH request');
          frames=[{...base,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_calendar',type:'function',function:{name:'mcp__study__list_calendar',arguments:'{"student":"ana"}'}}]},finish_reason:null}]},
            {...base,choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:10,cost:0.001}}];
        } else {
          assert(request.messages?.some(message=>message.role==='tool'&&JSON.stringify(message).includes('2026-11-02')),'broker result missing from model continuation');
          frames=[{...base,choices:[{index:0,delta:{role:'assistant',content:'I inspected the synthetic calendar.'},finish_reason:null}]},
            {...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,cost:0.001}}];
        }
        return new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join('')+'data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
      }});
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    session=new StudySession('ana',{brokerSocket:socketPath,gateway:{baseURL:`http://127.0.0.1:${server.address().port}/v1`,accessToken:'c'.repeat(64)},
      launch:(...args)=>{const child=spawn(...args);child.stderr.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-5000);});return child;}});
    await session.prompt('Inspect the synthetic calendar.');
    const deadline=Date.now()+15000;
    while(session.snapshot().busy&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(session.snapshot().busy,false);assert.equal(session.snapshot().error,null,JSON.stringify({calls,seen,messages:session.snapshot().messages,diagnostic}));
    assert(session.snapshot().messages.some(message=>message.type==='assistant'&&message.text.includes('I inspected the synthetic calendar.')));
    assert.equal(calls,2);assert.equal(writes,0);assert.equal((await budget.summary()).observedUsd,0.002);
  } finally {
    if(session?.child&&session.child.exitCode===null){const exited=new Promise(resolve=>session.child.once('exit',resolve));session.stop();await exited;}
    if(server)await new Promise(resolve=>server.close(resolve));await broker?.close();await budget?.close();
    if(previous===undefined)delete process.env.STUDY_ATLAS_RUNTIME_DIR;else process.env.STUDY_ATLAS_RUNTIME_DIR=previous;
    await rm(directory,{recursive:true,force:true});
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

test('a missing broker prevents a DSH model request',{timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-missing-broker-'));let budget,server,session,calls=0;
  const previous=process.env.STUDY_ATLAS_RUNTIME_DIR;
  try {
    process.env.STUDY_ATLAS_RUNTIME_DIR=directory;
    await mkdir(join(directory,'workspaces','ana'),{recursive:true});await mkdir(join(directory,'ipc'),{mode:0o700});
    budget=await createModelBudget({directory:join(directory,'budget')});
    server=createOpenRouterGateway({apiKey:'synthetic-provider-key',accessToken:'d'.repeat(64),budget,
      pricing:{inputPerMillion:0.3,outputPerMillion:1.2,verifiedAt:new Date().toISOString()},
      fetchImpl:async()=>{calls++;return new Response('data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});}});
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    session=new StudySession('ana',{brokerSocket:join(directory,'ipc','missing.sock'),gateway:{baseURL:`http://127.0.0.1:${server.address().port}/v1`,accessToken:'d'.repeat(64)}});
    try {await session.prompt('Inspect the synthetic calendar.');}catch{/* Failing before prompting is also safe. */}
    const deadline=Date.now()+12000;
    while(session.snapshot().busy&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(session.snapshot().busy,false);assert(session.snapshot().error);
    assert.equal(calls,0,'a missing broker must prevent any model call');
    assert.equal((await budget.summary()).observedUsd,0);
  } finally {
    if(session?.child&&session.child.exitCode===null){const exited=new Promise(resolve=>session.child.once('exit',resolve));session.stop();await exited;}
    if(server)await new Promise(resolve=>server.close(resolve));await budget?.close();
    if(previous===undefined)delete process.env.STUDY_ATLAS_RUNTIME_DIR;else process.env.STUDY_ATLAS_RUNTIME_DIR=previous;
    await rm(directory,{recursive:true,force:true});
  }
});

test('losing the broker during a turn prevents the next DSH model request',{timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-broker-loss-'));let budget,server,session,broker,calls=0;
  const previous=process.env.STUDY_ATLAS_RUNTIME_DIR;
  try {
    process.env.STUDY_ATLAS_RUNTIME_DIR=directory;
    const fixture=JSON.parse(await readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
    const calendar={events:async()=>structuredClone(fixture.events)};await initializeScenario(calendar,'ana');
    const ipc=join(directory,'ipc');await mkdir(ipc,{mode:0o700});const socketPath=join(ipc,'agent.sock');
    broker=await startStudyBroker({socketPath,boundary:createStudyBoundary({student:'ana',calendar})});
    budget=await createModelBudget({directory:join(directory,'budget')});
    server=createOpenRouterGateway({apiKey:'synthetic-provider-key',accessToken:'e'.repeat(64),budget,
      pricing:{inputPerMillion:0.3,outputPerMillion:1.2,verifiedAt:new Date().toISOString()},
      fetchImpl:async()=>{
        calls++;await broker?.close();broker=null;
        const base={id:'synthetic',object:'chat.completion.chunk',created:1,model:'deepseek/deepseek-v4.1-flash-1017'};
        const frames=[{...base,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_calendar',type:'function',function:{name:'mcp__study__list_calendar',arguments:'{"student":"ana"}'}}]},finish_reason:null}]},
          {...base,choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:10,cost:0.001}}];
        return new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join('')+'data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
      }});
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    session=new StudySession('ana',{brokerSocket:socketPath,gateway:{baseURL:`http://127.0.0.1:${server.address().port}/v1`,accessToken:'e'.repeat(64)}});
    await session.prompt('Inspect the synthetic calendar.');
    const deadline=Date.now()+15000;while(session.snapshot().busy&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(session.snapshot().busy,false);assert(session.snapshot().error);
    assert.equal(calls,1,'DSH must not make another request after the broker is lost');
    assert.equal((await budget.summary()).observedUsd,0.001);
  } finally {
    if(session?.child&&session.child.exitCode===null){const exited=new Promise(resolve=>session.child.once('exit',resolve));session.stop();await exited;}
    if(server)await new Promise(resolve=>server.close(resolve));await broker?.close();await budget?.close();
    if(previous===undefined)delete process.env.STUDY_ATLAS_RUNTIME_DIR;else process.env.STUDY_ATLAS_RUNTIME_DIR=previous;
    await rm(directory,{recursive:true,force:true});
  }
});
