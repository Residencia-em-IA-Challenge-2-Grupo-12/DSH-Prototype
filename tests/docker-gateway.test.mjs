import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {attachRunGateway,detachRunGateway} from '../src/foundation/docker-gateway.mjs';

test('a trusted gateway is attached and detached only on its run-labelled private network',async()=>{
  const runId=randomUUID(),gatewayId='a'.repeat(64),networkId='b'.repeat(64),network=`study-agent-net-${runId}`;let attached=false;const calls=[];
  const lease={assertHeld(){}};
  const runDocker=async(...args)=>{
    calls.push(args);
    if(args[0]==='network'&&args[1]==='ls')return networkId.slice(0,12);
    if(args[0]==='network'&&args[1]==='inspect')return JSON.stringify({Id:networkId,Name:network,Internal:true,Labels:{'study.run.id':runId},Containers:attached?{[gatewayId]:{Name:'gateway'}}:{}});
    if(args[0]==='inspect')return JSON.stringify({Id:gatewayId,Config:{Labels:{'study.role':'model-gateway'}},State:{Running:true},NetworkSettings:{Networks:attached?{[network]:{Aliases:['model-gateway']}}:{}}});
    if(args[0]==='ps')return '';
    if(args[0]==='network'&&args[1]==='connect'){attached=true;return '';}
    if(args[0]==='network'&&args[1]==='disconnect'){attached=false;return '';}
    throw new Error('Unexpected Docker operation');
  };
  await attachRunGateway({runId,gatewayId,lease,runDocker});assert(attached);
  await attachRunGateway({runId,gatewayId,lease,runDocker});assert.equal(calls.filter(args=>args[1]==='connect').length,1);
  await detachRunGateway({runId,gatewayId,lease,runDocker});assert(!attached);
});

test('a gateway with the wrong trusted role is never attached',async()=>{
  const runId=randomUUID(),gatewayId='a'.repeat(64),networkId='b'.repeat(64),calls=[];
  const runDocker=async(...args)=>{
    calls.push(args);
    if(args[0]==='network'&&args[1]==='ls')return networkId.slice(0,12);
    if(args[0]==='network'&&args[1]==='inspect')return JSON.stringify({Id:networkId,Name:`study-agent-net-${runId}`,Internal:true,Labels:{'study.run.id':runId},Containers:{}});
    if(args[0]==='inspect')return JSON.stringify({Id:gatewayId,Config:{Labels:{}},State:{Running:true},NetworkSettings:{Networks:{}}});
    throw new Error('Unexpected Docker operation');
  };
  await assert.rejects(attachRunGateway({runId,gatewayId,lease:{assertHeld(){}},runDocker}),/gateway.*identity/i);
  assert(!calls.some(args=>args[1]==='connect'));
});
