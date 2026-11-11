import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inspectDockerAgent,retireDockerAgent,retireDockerNetwork} from '../src/foundation/docker-retirement.mjs';

function fakeDocker(runId){
  const id='a'.repeat(64),name=`study-agent-${runId}`,calls=[];let present=true,running=true,label=runId;
  return {calls,setLabel(value){label=value;},run:async(...args)=>{
    calls.push(args);
    if(args[0]==='ps')return present?id.slice(0,12):'';
    if(args[0]==='inspect')return JSON.stringify({Id:id,Name:`/${name}`,Config:{Labels:{'study.run.id':label}},State:{Running:running}});
    if(args[0]==='stop'){running=false;return id;}
    if(args[0]==='rm'){present=false;return id;}
    throw new Error('Unexpected Docker operation');
  }};
}
const lease={assertHeld(){}};

test('only the matching labelled agent is stopped and verified absent',async()=>{
  const runId=randomUUID(),docker=fakeDocker(runId);
  assert.equal((await inspectDockerAgent({runId,lease,runDocker:docker.run})).state,'running');
  assert.deepEqual(await retireDockerAgent({runId,lease,runDocker:docker.run}),{state:'absent'});
  assert.equal((await inspectDockerAgent({runId,lease,runDocker:docker.run})).state,'absent');
  assert(docker.calls.some(args=>args[0]==='stop'&&args.at(-1)==='a'.repeat(64)));
  assert(docker.calls.some(args=>args[0]==='rm'&&args.at(-1)==='a'.repeat(64)));
});

test('a run network is removed only when its label matches and it has no attached containers',async()=>{
  const runId=randomUUID(),networkId='b'.repeat(64),name=`study-agent-net-${runId}`;let present=true,attached=true;const calls=[];
  const runDocker=async(...args)=>{
    calls.push(args);
    if(args[0]==='network'&&args[1]==='ls')return present?networkId.slice(0,12):'';
    if(args[0]==='network'&&args[1]==='inspect')return JSON.stringify({Id:networkId,Name:name,Internal:true,Labels:{'study.run.id':runId},Containers:attached?{'container':{}}:{}});
    if(args[0]==='network'&&args[1]==='rm'){present=false;return networkId;}
    throw new Error('Unexpected Docker operation');
  };
  await assert.rejects(retireDockerNetwork({runId,kind:'agent',lease,runDocker}),/attached/i);
  assert(!calls.some(args=>args[0]==='network'&&args[1]==='rm'));
  attached=false;assert.deepEqual(await retireDockerNetwork({runId,kind:'agent',lease,runDocker}),{state:'absent'});
});

test('a mismatched identity or unavailable Docker daemon is never treated as retired',async()=>{
  const runId=randomUUID(),docker=fakeDocker(runId);docker.setLabel('other-run');
  await assert.rejects(retireDockerAgent({runId,lease,runDocker:docker.run}),/identity/i);
  assert(!docker.calls.some(args=>args[0]==='stop'||args[0]==='rm'));
  await assert.rejects(inspectDockerAgent({runId,lease,runDocker:async()=>{throw new Error('daemon unavailable');}}),/unknown|inspection/i);
  await assert.rejects(inspectDockerAgent({runId,lease:{assertHeld(){throw new Error('lease lost');}},runDocker:docker.run}),/lease/i);
});
