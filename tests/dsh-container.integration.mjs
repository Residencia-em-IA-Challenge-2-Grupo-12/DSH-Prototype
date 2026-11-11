import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {ROOT} from '../src/core.mjs';

const image='node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57';

test('a disposable DSH container reaches a fake gateway without key or Docker socket mounts',
  {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:120000},async()=>{
  const id=randomBytes(6).toString('hex'),network=`study-model-test-${id}`,gateway=`study-fake-gateway-${id}`;
  const modules=dirname(await realpath(join(ROOT,'node_modules/@deepseek-ai')));
  const docker=(...args)=>{const result=spawnSync('docker',args,{encoding:'utf8',timeout:60000});assert.equal(result.status,0,`Docker ${args[0]} failed: ${result.stderr}`);return result.stdout;};
  const mount=(source,target)=>['--mount',`type=bind,source=${source},target=${target},readonly`];
  const restrictions=['--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '--tmpfs','/tmp:rw,nosuid,nodev','--memory','768m','--cpus','1','--pids-limit','256','--network',network];
  let created=false;
  try {
    docker('network','create','--internal','--label','study.test=synthetic-model',network);created=true;
    docker('run','-d','--rm','--name',gateway,...restrictions,'--network-alias','model-gateway',
      ...mount(join(ROOT,'src'),'/app/src'),...mount(join(ROOT,'tests/fixtures/fake-gateway-container.mjs'),'/app/fake-gateway.mjs'),image,'node','/app/fake-gateway.mjs');
    const output=docker('run','--rm',...restrictions,'--workdir','/app','--env','STUDY_ATLAS_RUNTIME_DIR=/tmp/study-runtime',
      ...mount(join(ROOT,'src'),'/app/src'),...mount(modules,'/app/node_modules'),
      ...mount(join(ROOT,'dsh-study.patch.yml'),'/app/dsh-study.patch.yml'),...mount(join(ROOT,'dsh-gateway.patch.yml'),'/app/dsh-gateway.patch.yml'),
      ...mount(join(ROOT,'tests/fixtures/dsh-container-probe.mjs'),'/app/probe.mjs'),image,'node','/app/probe.mjs');
    assert.match(output,/Synthetic DSH container completed/);
  } finally {
    spawnSync('docker',['rm','-f',gateway],{encoding:'utf8',timeout:20000});
    if(created)docker('network','rm',network);
  }
});
