import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireControllerLease} from '../src/foundation/controller-lease.mjs';
import {inspectDockerAgent,retireDockerAgent,inspectDockerNetwork,retireDockerNetwork} from '../src/foundation/docker-retirement.mjs';

test('a labelled synthetic agent is stopped and its absence verified in Docker',
  {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-agent-stop-')),runId=randomUUID(),name=`study-agent-${runId}`;let lease;
  try {
    lease=await acquireControllerLease({directory});
    await promisify(execFile)('docker',['run','-d','--rm','--name',name,'--label',`study.run.id=${runId}`,'--network','none',
      '--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
      'node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57','node','-e','setInterval(()=>{},1000)'],{timeout:15000});
    const before=await inspectDockerAgent({runId,lease});assert.equal(before.state,'running');assert.match(before.id,/^[a-f0-9]{64}$/);
    assert.deepEqual(await retireDockerAgent({runId,lease}),{state:'absent'});
    assert.deepEqual(await inspectDockerAgent({runId,lease}),{state:'absent'});
  } finally {spawnSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});await lease?.release();await rm(directory,{recursive:true,force:true});}
});

test('a labelled empty synthetic network is removed and verified absent',
  {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-network-stop-')),runId=randomUUID(),name=`study-agent-net-${runId}`;let lease;
  try {
    lease=await acquireControllerLease({directory});
    await promisify(execFile)('docker',['network','create','--internal','--label',`study.run.id=${runId}`,name],{timeout:15000});
    const before=await inspectDockerNetwork({runId,kind:'agent',lease});assert.equal(before.state,'present');assert.equal(before.attached,0);
    assert.deepEqual(await retireDockerNetwork({runId,kind:'agent',lease}),{state:'absent'});
    assert.deepEqual(await inspectDockerNetwork({runId,kind:'agent',lease}),{state:'absent'});
  } finally {spawnSync('docker',['network','rm',name],{stdio:'ignore',timeout:10000});await lease?.release();await rm(directory,{recursive:true,force:true});}
});
