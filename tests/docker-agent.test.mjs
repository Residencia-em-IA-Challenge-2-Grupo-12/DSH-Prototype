import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureGatewayTokenFile} from '../src/foundation/gateway-token.mjs';
import {startStudyBroker} from '../src/foundation/study-broker.mjs';
import {startDockerAgent} from '../src/foundation/docker-agent.mjs';

test('trusted launcher binds only a private broker and internal control credential',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-agent-launch-')),runId=randomUUID(),ipc=join(root,'ipc');let broker,agent,call;
  try {
    await mkdir(ipc,{mode:0o700});broker=await startStudyBroker({socketPath:join(ipc,'agent.sock'),boundary:{call:async()=>null}});
    const token=await ensureGatewayTokenFile({directory:join(root,'control')});
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    agent=await startDockerAgent({runId,student:'ana',runDirectory:root,tokenFile:token.file,image:'sha256:'+'a'.repeat(64),
      inspectNetwork:async()=>({Name:`study-agent-net-${runId}`,Internal:true,Labels:{'study.run.id':runId}}),
      launch:(command,args,options)=>{call={command,args,options};return child;}});
    assert.equal(call.command,'docker');
    assert(call.args.includes(`study-agent-${runId}`));assert(call.args.includes(`study.run.id=${runId}`));
    assert(call.args.includes('--read-only'));assert(call.args.includes('no-new-privileges:true'));
    assert.equal(call.args.filter(item=>item==='--mount').length,2);
    assert(!JSON.stringify(call.args).includes(token.accessToken));
    assert(!JSON.stringify(call.args).includes('OPENROUTER_API_KEY'));
    assert.equal('approve' in agent.client,false);
  } finally {agent?.client.close();await broker?.close();await rm(root,{recursive:true,force:true});}
});

test('launcher refuses a mismatched or externally connected run network',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-agent-reject-')),runId=randomUUID(),ipc=join(root,'ipc');let broker;
  try {
    await mkdir(ipc,{mode:0o700});broker=await startStudyBroker({socketPath:join(ipc,'agent.sock'),boundary:{call:async()=>null}});
    const token=await ensureGatewayTokenFile({directory:join(root,'control')});
    const base={runId,student:'ana',runDirectory:root,tokenFile:token.file,image:'sha256:'+'b'.repeat(64)};
    await assert.rejects(startDockerAgent({...base,inspectNetwork:async()=>({Name:`study-agent-net-${runId}`,Internal:false,Labels:{'study.run.id':runId}})}),/network/i);
    await assert.rejects(startDockerAgent({...base,image:'unversioned:latest'}),/image/i);
  } finally {await broker?.close();await rm(root,{recursive:true,force:true});}
});
