import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {ROOT,initializeScenario,loadState,applyApproved,getRecoveryClaim,digest} from '../src/core.mjs';
import {createStudyBoundary} from '../src/foundation/study-boundary.mjs';
import {startStudyBroker} from '../src/foundation/study-broker.mjs';
import {startCalendarpitRun} from '../src/foundation/calendarpit-runner.mjs';
import {createClaimedCalendar} from '../src/foundation/claimed-calendar.mjs';
import {syntheticToken} from './fixtures/calendarpit-oauth.mjs';

const image='node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57';
const agentImage=process.env.STUDY_DSH_IMAGE||image;
const repeats=Number(process.env.STUDY_DOCKER_REPEATS||1);
if(!Number.isInteger(repeats)||repeats<1||repeats>10)throw new Error('Synthetic Docker repeats must be 1 to 10');

for(const student of ['ana','bruno'])for(let repeat=1;repeat<=repeats;repeat++)test(`${student} run ${repeat}: isolated DSH drafts and separately approved Calendarpit changes`,
  {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:120000},async()=>{
  const id=randomBytes(6).toString('hex'),network=`study-model-test-${id}`,gateway=`study-fake-gateway-${id}`;
  const modules=agentImage===image?dirname(await realpath(join(ROOT,'node_modules/@deepseek-ai'))):null;
  const docker=(...args)=>{const result=spawnSync('docker',args,{encoding:'utf8',timeout:60000});assert.equal(result.status,0,`Docker ${args[0]} failed: ${result.stderr}`);return result.stdout;};
  const dockerAsync=async(...args)=>(await promisify(execFile)('docker',args,{encoding:'utf8',timeout:60000})).stdout;
  const mount=(source,target)=>['--mount',`type=bind,source=${source},target=${target},readonly`];
  const restrictions=['--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '--tmpfs','/tmp:rw,nosuid,nodev','--memory','768m','--cpus','1','--pids-limit','256','--network',network];
  let created=false,broker,simulator;const directory=await mkdtemp(join(tmpdir(),'study-container-run-'));const previous=process.env.STUDY_ATLAS_RUNTIME_DIR;
  try {
    process.env.STUDY_ATLAS_RUNTIME_DIR=directory;
    const fixture=JSON.parse(await readFile(new URL(`../fixtures/calendars/${student}.json`,import.meta.url),'utf8'));
    const redirectUri='http://127.0.0.1:4175/callback';simulator=await startCalendarpitRun({fixture,redirectUri});
    const token=await syntheticToken(simulator,student,redirectUri);
    const calendar=createClaimedCalendar({origin:simulator.origin,accessToken:token,getClaim:getRecoveryClaim});
    await initializeScenario(calendar,student);const before=await calendar.events(student);
    const ipc=join(directory,'ipc');await mkdir(ipc,{mode:0o700});
    broker=await startStudyBroker({socketPath:join(ipc,'agent.sock'),boundary:createStudyBoundary({student,calendar})});
    docker('network','create','--internal','--label','study.test=synthetic-model',network);created=true;
    docker('run','-d','--rm','--name',gateway,...restrictions,'--network-alias','model-gateway','--env',`STUDY_TEST_STUDENT=${student}`,
      ...mount(join(ROOT,'src'),'/app/src'),...mount(join(ROOT,'tests/fixtures/fake-gateway-container.mjs'),'/app/fake-gateway.mjs'),image,'node','/app/fake-gateway.mjs');
    const agentMounts=modules?[...mount(join(ROOT,'src'),'/app/src'),...mount(modules,'/app/node_modules'),
      ...mount(join(ROOT,'dsh-study.patch.yml'),'/app/dsh-study.patch.yml'),...mount(join(ROOT,'dsh-broker.patch.yml'),'/app/dsh-broker.patch.yml'),
      ...mount(join(ROOT,'dsh-gateway.patch.yml'),'/app/dsh-gateway.patch.yml')]:[];
    const output=await dockerAsync('run','--rm',...restrictions,'--workdir','/app','--env','STUDY_ATLAS_RUNTIME_DIR=/tmp/study-runtime','--env',`STUDY_TEST_STUDENT=${student}`,
      ...agentMounts,...mount(ipc,'/run/study-broker'),...mount(join(ROOT,'tests/fixtures/dsh-container-probe.mjs'),'/app/probe.mjs'),agentImage,'node','/app/probe.mjs');
    assert.match(output,/Synthetic DSH container completed/);
    assert.equal(digest(await calendar.events(student)),digest(before),'an agent draft must not write to the calendar');
    const plan=(await loadState(student)).plan;assert(plan?.near.length>0);
    assert.equal(plan.outlook.length,student==='ana'?4:6);
    const time=(event,key)=>Date.parse(event[key]?.dateTime||event[key]?.date);
    for(const block of plan.near)for(const existing of before.filter(event=>event.status!=='cancelled'&&event.transparency!=='transparent'))
      assert(!(time(block,'start')<time(existing,'end')&&time(existing,'start')<time(block,'end')),'study block conflicts with an existing commitment');
    await applyApproved(calendar,student,plan.id,'near');
    const after=await calendar.events(student);
    assert.equal(after.length,before.length+plan.near.length);
    for(const event of before)assert.equal(digest(after.filter(actual=>actual.id===event.id)),digest([event]),'existing event changed');
    for(const event of plan.future)assert(!after.some(actual=>actual.id===event.id),'future section was not approved');
    assert.equal((await loadState(student)).plan.status.future,'pending');assert.equal(await getRecoveryClaim(),null);
  } finally {
    spawnSync('docker',['rm','-f',gateway],{encoding:'utf8',timeout:20000});
    try {if(created)docker('network','rm',network);}
    finally {
      await broker?.close();await simulator?.close();if(previous===undefined)delete process.env.STUDY_ATLAS_RUNTIME_DIR;else process.env.STUDY_ATLAS_RUNTIME_DIR=previous;
      await rm(directory,{recursive:true,force:true});
    }
  }
});
