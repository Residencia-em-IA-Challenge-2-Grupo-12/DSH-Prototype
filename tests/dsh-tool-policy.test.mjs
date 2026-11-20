import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../src/dsh-tool-policy.mjs';

test('the DSH tool policy allows only the synthetic study tools and native questions',()=>{
  let guard;
  apply({tools:{guard:fn=>{guard=fn;}}});
  for(const name of ['ask_user_question','mcp__study__list_synthetic_files','mcp__study__read_synthetic_file','mcp__study__list_calendar','mcp__study__draft_study_plan','mcp__study__inspect_checkpoint','mcp__study__routine_report','mcp__study__save_report_interpretation'])assert.equal(guard({name}),undefined,name);
  for(const name of ['bash','read','write','edit','run_code','plugin_manager','subagent','web_fetch','mcp__study__approve','unknown_tool'])assert.match(guard({name}),/not available/i,name);
});

test('brokered agents restrict inherited plugin tools before catalog verification',()=>{
  const previous=process.env.STUDY_BROKER_SOCKET;process.env.STUDY_BROKER_SOCKET='/tmp/synthetic-broker.sock';
  try {
    const hooks=new Map();apply({tools:{guard(){}},on:(name,fn)=>hooks.set(name,fn)});
    let restriction;hooks.get('agent/created')({agent:{ctx:{tools:{restrict:value=>{restriction=value;}}}}});
    assert.equal(restriction.allow.length,8);assert(!restriction.allow.includes('image_generate'));
    assert(restriction.allow.includes('ask_user_question'));assert(hooks.has('agent/pre-step'));
  } finally {if(previous===undefined)delete process.env.STUDY_BROKER_SOCKET;else process.env.STUDY_BROKER_SOCKET=previous;}
});

test('brokered model calls reject alternate routes before dispatch',()=>{
  const previous=process.env.STUDY_BROKER_SOCKET,oldGateway=process.env.STUDY_GATEWAY_BASE_URL;
  process.env.STUDY_BROKER_SOCKET='/tmp/synthetic-broker.sock';
  try{
    for(const gateway of [false,true]){
      if(gateway)process.env.STUDY_GATEWAY_BASE_URL='http://model-gateway:8090/v1';else delete process.env.STUDY_GATEWAY_BASE_URL;
      const hooks=new Map();apply({tools:{guard(){}},on:(name,fn)=>hooks.set(name,fn)});
      const guard=hooks.get('llm/stream');let dispatches=0;const next=()=>++dispatches;
      const route=gateway?{provider:'study-gateway',model:'deepseek/deepseek-v4.1-flash-1017'}:{provider:'codex',model:'gpt-6-luna'};
      assert.equal(guard(route,next),1);
      assert.throws(()=>guard({...route,model:'unsupported'},next),/not authorized/);
      assert.throws(()=>guard({...route,provider:'unsupported'},next),/not authorized/);
      assert.equal(dispatches,1);
    }
  }finally{
    if(previous===undefined)delete process.env.STUDY_BROKER_SOCKET;else process.env.STUDY_BROKER_SOCKET=previous;
    if(oldGateway===undefined)delete process.env.STUDY_GATEWAY_BASE_URL;else process.env.STUDY_GATEWAY_BASE_URL=oldGateway;
  }
});
