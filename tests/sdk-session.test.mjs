import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import {writeFileSync} from 'node:fs';
import { StudySession } from '../src/sdk-session.mjs';

function fakeHarness(expected={provider:'codex',model:'gpt-6-luna'}) {
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
  let waitId,sessionId,questionAnswered=false,approvalAnswer;
  const emit=frame=>child.stdout.write(JSON.stringify(frame)+'\n');
  child.stdin=new Writable({write(chunk,encoding,done){
    for(const line of chunk.toString().trim().split('\n')){
      const frame=JSON.parse(line);
      if(frame.method==='initialize') {
        assert.equal(frame.params.provider,expected.provider);assert.equal(frame.params.model,expected.model);
        emit({jsonrpc:'2.0',id:frame.id,result:{serverInfo:{name:'test'}}});
      } else if(frame.method==='session/prompt') {
        sessionId=frame.params.sessionId;emit({jsonrpc:'2.0',id:frame.id,result:{messageId:'m1'}});
        emit({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type:'tool/call',data:{name:'ask_user_question'}}}});
        emit({jsonrpc:'2.0',id:'q1',method:'user-question/ask',params:{requestId:'request1',questions:[{id:'hours',question:'How many?',options:[{label:'3 hours'},{label:'5 hours'}]}]}});
        emit({jsonrpc:'2.0',id:'approval1',method:'approval/request',params:{}});
      } else if(frame.method==='session/wait') waitId=frame.id;
      else if(frame.id==='approval1') approvalAnswer=frame.result;
      else if(frame.id==='q1') {
        assert.deepEqual(frame.result,{answers:[{id:'hours',selected:['3 hours']}]});questionAnswered=true;
        emit({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type:'assistant/message',data:{message:{content:[{type:'text',text:'I will draft three hours.'}]}}}}});
        emit({jsonrpc:'2.0',id:waitId,result:{}});
      }
    }done();
  }});
  child.kill=()=>{child.killed=true;child.emit('exit',0);};
  return {child,get questionAnswered(){return questionAnswered;},get approvalAnswer(){return approvalAnswer;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('SDK conversation forwards a question and fails approval closed',async()=>{
  const fake=fakeHarness(), session=new StudySession('ana',{launch:()=>fake.child});
  await session.prompt('Help me plan');await flush();
  assert.equal(session.snapshot().busy,true);assert.equal(session.snapshot().question.questions[0].id,'hours');
  assert.deepEqual(fake.approvalAnswer,{outcome:'rejected'});
  assert.throws(()=>session.answer('wrong',[]),/no longer pending/);
  assert.throws(()=>session.answer('request1',[{id:'hours',selected:['not offered']}]),/Invalid answer/);
  session.answer('request1',[{id:'hours',selected:['3 hours']}]);await flush();
  assert(fake.questionAnswered);assert.equal(session.snapshot().busy,false);assert.equal(session.snapshot().question,null);
  assert(session.snapshot().messages.some(m=>m.type==='assistant'&&m.text.includes('three hours')));
  session.stop();assert(fake.child.killed);
});

test('an explicitly configured comparison session uses only the gateway credential',async()=>{
  const fake=fakeHarness({provider:'study-gateway',model:'deepseek/deepseek-v4.1-flash-1017'});let launch;
  const previous=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='synthetic-private-key';
  const session=new StudySession('ana',{gateway:{baseURL:'http://127.0.0.1:12345/v1',accessToken:'a'.repeat(64)},
    launch:(command,args,options)=>{launch={command,args,options};return fake.child;}});
  try {
    await session.start();
    assert.equal(launch.command,process.execPath);
    assert(launch.args.some(arg=>arg.endsWith('/dsh-gateway.patch.yml')));
    assert.equal(launch.options.env.STUDY_GATEWAY_TOKEN,'a'.repeat(64));
    assert.equal(launch.options.env.OPENROUTER_API_KEY,undefined);
    assert.equal(launch.options.env.NARB_DISABLE_NATIVE_CACHE,'1');
  } finally {
    session.stop();if(previous===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previous;
  }
});

test('a brokered session uses the broker-only MCP profile and does not inherit provider keys',async()=>{
  const fake=fakeHarness();let launch;const previous=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='synthetic-private-key';
  const session=new StudySession('ana',{brokerSocket:'/run/study-broker/agent.sock',brokerProbe:async()=>true,
    launch:(command,args,options)=>{launch={args,options};writeFileSync(options.env.STUDY_POLICY_READY,'guard-registered',{mode:0o600,flag:'wx'});return fake.child;}});
  try {
    await session.start();
    assert(launch.args.some(arg=>arg.endsWith('/dsh-broker.patch.yml')));
    assert.equal(launch.options.env.STUDY_BROKER_SOCKET,'/run/study-broker/agent.sock');
    assert.equal(launch.options.env.OPENROUTER_API_KEY,undefined);
    assert.equal(launch.options.env.NARB_DISABLE_NATIVE_CACHE,'1');
    assert.throws(()=>new StudySession('ana',{brokerSocket:'relative'}));
  } finally {
    session.stop();if(previous===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previous;
  }
});

test('a brokered session rejects startup when the tool policy did not activate',async()=>{
  const fake=fakeHarness();
  const session=new StudySession('ana',{brokerSocket:'/run/study-broker/agent.sock',brokerProbe:async()=>true,launch:()=>fake.child});
  try {
    await assert.rejects(session.start(),/tool policy/i);
    assert(fake.child.killed);
  } finally {session.stop();}
});

test('a trusted host fallback can use a persistent DSH profile without changing the run workspace',async()=>{
  const fake=fakeHarness();let launch;
  const session=new StudySession('bruno',{dshHome:'/private/persistent-dsh',brokerSocket:'/run/study-broker/agent.sock',brokerProbe:async()=>true,
    launch:(command,args,options)=>{launch={args,options};writeFileSync(options.env.STUDY_POLICY_READY,'guard-registered',{mode:0o600,flag:'wx'});return fake.child;}});
  try {
    await session.start();assert.equal(launch.options.env.DSH_HOME,'/private/persistent-dsh');
    assert.equal(launch.options.env.STUDY_BROKER_SOCKET,'/run/study-broker/agent.sock');
    assert.throws(()=>new StudySession('ana',{dshHome:'relative'}),/DSH profile/i);
    assert.throws(()=>new StudySession('ana',{dshHome:'/private/persistent-dsh'}),/brokered Luna/i);
    assert.throws(()=>new StudySession('ana',{dshHome:'/private/persistent-dsh',brokerSocket:'/run/study-broker/agent.sock',gateway:{baseURL:'http://127.0.0.1:12345/v1',accessToken:'a'.repeat(64)}}),/brokered Luna/i);
  } finally {session.stop();}
});
