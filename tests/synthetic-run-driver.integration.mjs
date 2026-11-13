import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT,loadState,withSyntheticRuntime} from '../src/core.mjs';
import {createExclusiveRunManager} from '../src/foundation/exclusive-run-manager.mjs';
import {createSyntheticRunDriver} from '../src/foundation/synthetic-run-driver.mjs';

const repeats=Number(process.env.STUDY_MANAGED_REPEATS||1);
if(!Number.isInteger(repeats)||repeats<1||repeats>10)throw new Error('STUDY_MANAGED_REPEATS must be between 1 and 10');
for(const student of ['ana','bruno'])for(let repetition=1;repetition<=repeats;repetition++)test(`trusted lifecycle: ${student} run ${repetition} archives before verified retirement`,
  {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:120000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-managed-run-')),testId=randomUUID(),gatewayName=`study-test-gateway-${testId}`,gatewayNetwork=`study-test-gateway-net-${testId}`;
  let manager,driver,run;const exec=promisify(execFile),imageTag=process.env.STUDY_DSH_IMAGE||'study-dsh-agent:synthetic';
  const docker=async(...args)=>(await exec('docker',args,{timeout:20000,maxBuffer:64000})).stdout.trim();
  try {
    const control=join(root,'control');await mkdir(control,{mode:0o700});const tokenFile=join(control,'gateway-token');await writeFile(tokenFile,'a'.repeat(64)+'\n',{mode:0o600});
    const agentImage=await docker('image','inspect','--format','{{.Id}}',imageTag);
    await docker('network','create','--internal',gatewayNetwork);
    const gatewayId=await docker('run','-d','--rm','--name',gatewayName,'--label','study.role=model-gateway','--network',gatewayNetwork,
      '--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,nodev',
      '--env',`STUDY_TEST_STUDENT=${student}`,'--mount',`type=bind,source=${join(ROOT,'src')},target=/app/src,readonly`,
      '--mount',`type=bind,source=${join(ROOT,'tests/fixtures/fake-gateway-container.mjs')},target=/app/fake-gateway.mjs,readonly`,
      'node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57','node','/app/fake-gateway.mjs');
    manager=await createExclusiveRunManager({root,driverFactory:({lease})=>{
      driver=createSyntheticRunDriver({root,lease,agentImage,tokenFile,gatewayId});return driver;
    }});
    run=await manager.start(student);const active=driver.active(run.id);assert(active);
    const before=(await active.service.agent.call('list_calendar',{student})).events;
    let view=await active.client.prompt('Inspect and draft for the synthetic student.');const deadline=Date.now()+15000;
    while(view.busy&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,50));view=await active.client.snapshot();}
    assert.equal(view.busy,false);assert.equal(view.error,null);assert(view.messages.some(item=>item.text.includes('Synthetic container response.')));
    const state=await withSyntheticRuntime(active.runDirectory,()=>loadState(student));assert(state.plan.near.length>0);
    assert.equal(state.plan.outlook.length,student==='ana'?4:6);
    const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    assert.equal(digest((await active.service.agent.call('list_calendar',{student})).events),digest(before),'drafting changed the calendar');
    const time=(event,key)=>Date.parse(event[key]?.dateTime||event[key]?.date);
    for(const block of state.plan.near)for(const existing of before.filter(event=>event.status!=='cancelled'&&event.transparency!=='transparent'))
      assert(!(time(block,'start')<time(existing,'end')&&time(existing,'start')<time(block,'end')),'study block conflicts with an existing commitment');
    await active.service.approvePlan(state.plan.id,'near');
    const after=(await active.service.agent.call('list_calendar',{student})).events;
    assert.equal(after.length,before.length+state.plan.near.length);
    for(const event of before)assert.equal(digest(after.filter(actual=>actual.id===event.id)),digest([event]),'existing event changed');
    for(const event of state.plan.future)assert(!after.some(actual=>actual.id===event.id),'future section was not approved');
    assert.equal((await withSyntheticRuntime(active.runDirectory,()=>loadState(student))).plan.status.future,'pending');
    const attempts=await readdir(join(active.runDirectory,'experiments'));assert.equal(attempts.length,1);
    const trace=(await readFile(join(active.runDirectory,'experiments',attempts[0],'trace.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert(trace.some(row=>row.kind==='configuration'&&row.data.fixtureSha256));
    assert(trace.some(row=>row.kind==='tool'&&row.data.method==='draft_study_plan'&&row.data.phase==='completed'));
    assert(trace.some(row=>row.kind==='decision'&&row.data.section==='near'));
    assert(trace.some(row=>row.kind==='write'&&row.data.section==='near'));
    const result=await manager.retire();assert.equal(result.archiveId,run.id);assert.match(result.archiveSha256,/^[a-f0-9]{64}$/);
    const archive=JSON.parse(await readFile(join(root,'archives',`${run.id}.json`),'utf8'));
    assert.equal(archive.snapshot.claimHistory.at(-1).decision.kind,'approved');assert.equal(archive.observation.availability,'available');
    assert.equal((await manager.completed(run.id)).archiveSha256,result.archiveSha256);assert.equal(await manager.current(),null);
  } finally {
    const remaining=run||await manager?.current().catch(()=>null);let closeError;
    try {await manager?.close();}catch(error){closeError=error;}
    if(remaining)for(const name of [`study-agent-${remaining.id}`,`study-calendar-${remaining.id}`])spawnSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});
    spawnSync('docker',['rm','-f',gatewayName],{stdio:'ignore',timeout:10000});
    if(remaining)for(const name of [`study-agent-net-${remaining.id}`,`study-calendar-net-${remaining.id}`])spawnSync('docker',['network','rm',name],{stdio:'ignore',timeout:10000});
    spawnSync('docker',['network','rm',gatewayNetwork],{stdio:'ignore',timeout:10000});
    await rm(root,{recursive:true,force:true});
    if(closeError)throw closeError;
  }
});

test('managed retirement records an unavailable simulator rather than an empty calendar',
  {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:120000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-managed-unavailable-')),testId=randomUUID(),gatewayName=`study-test-gateway-${testId}`,gatewayNetwork=`study-test-gateway-net-${testId}`;
  const exec=promisify(execFile),docker=async(...args)=>(await exec('docker',args,{timeout:20000,maxBuffer:64000})).stdout.trim();
  let manager,driver,run;
  try {
    const control=join(root,'control');await mkdir(control,{mode:0o700});const tokenFile=join(control,'gateway-token');await writeFile(tokenFile,'a'.repeat(64)+'\n',{mode:0o600});
    const agentImage=await docker('image','inspect','--format','{{.Id}}',process.env.STUDY_DSH_IMAGE||'study-dsh-agent:synthetic');
    await docker('network','create','--internal',gatewayNetwork);
    const gatewayId=await docker('run','-d','--rm','--name',gatewayName,'--label','study.role=model-gateway','--network',gatewayNetwork,
      '--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,nodev',
      '--env','STUDY_TEST_STUDENT=ana','--mount',`type=bind,source=${join(ROOT,'src')},target=/app/src,readonly`,
      '--mount',`type=bind,source=${join(ROOT,'tests/fixtures/fake-gateway-container.mjs')},target=/app/fake-gateway.mjs,readonly`,
      'node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57','node','/app/fake-gateway.mjs');
    manager=await createExclusiveRunManager({root,driverFactory:({lease})=>{
      driver=createSyntheticRunDriver({root,lease,agentImage,tokenFile,gatewayId});return driver;
    }});
    run=await manager.start('ana');assert(driver.active(run.id));
    await docker('rm','-f',`study-calendar-${run.id}`);
    await manager.retire();
    const archive=JSON.parse(await readFile(join(root,'archives',`${run.id}.json`),'utf8'));
    assert.equal(archive.observation.availability,'unavailable');assert.equal(archive.observation.events,null);
    assert.equal(await manager.current(),null);
  } finally {
    const remaining=run||await manager?.current().catch(()=>null);let closeError;
    try {await manager?.close();}catch(error){closeError=error;}
    if(remaining)for(const name of [`study-agent-${remaining.id}`,`study-calendar-${remaining.id}`])spawnSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});
    spawnSync('docker',['rm','-f',gatewayName],{stdio:'ignore',timeout:10000});
    if(remaining)for(const name of [`study-agent-net-${remaining.id}`,`study-calendar-net-${remaining.id}`])spawnSync('docker',['network','rm',name],{stdio:'ignore',timeout:10000});
    spawnSync('docker',['network','rm',gatewayNetwork],{stdio:'ignore',timeout:10000});await rm(root,{recursive:true,force:true});
    if(closeError)throw closeError;
  }
});

test('managed agent refuses a turn when its policy plugin fails to activate',
  {skip:process.env.STUDY_DOCKER_TEST!=='1'||!process.env.STUDY_BAD_DSH_IMAGE,timeout:120000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-managed-policy-')),testId=randomUUID(),gatewayName=`study-test-gateway-${testId}`,gatewayNetwork=`study-test-gateway-net-${testId}`;
  const exec=promisify(execFile),docker=async(...args)=>(await exec('docker',args,{timeout:20000,maxBuffer:64000})).stdout.trim();
  let manager,driver,run;
  try {
    const control=join(root,'control');await mkdir(control,{mode:0o700});const tokenFile=join(control,'gateway-token');await writeFile(tokenFile,'a'.repeat(64)+'\n',{mode:0o600});
    const agentImage=await docker('image','inspect','--format','{{.Id}}',process.env.STUDY_BAD_DSH_IMAGE);
    await docker('network','create','--internal',gatewayNetwork);
    const gatewayId=await docker('run','-d','--rm','--name',gatewayName,'--label','study.role=model-gateway','--network',gatewayNetwork,
      '--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,nodev',
      '--env','STUDY_TEST_STUDENT=ana','--mount',`type=bind,source=${join(ROOT,'src')},target=/app/src,readonly`,
      '--mount',`type=bind,source=${join(ROOT,'tests/fixtures/fake-gateway-container.mjs')},target=/app/fake-gateway.mjs,readonly`,
      'node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57','node','/app/fake-gateway.mjs');
    manager=await createExclusiveRunManager({root,driverFactory:({lease})=>{
      driver=createSyntheticRunDriver({root,lease,agentImage,tokenFile,gatewayId});return driver;
    }});
    run=await manager.start('ana');const active=driver.active(run.id);
    const before=(await active.service.agent.call('list_calendar',{student:'ana'})).events;
    await assert.rejects(active.client.prompt('Inspect and draft for the synthetic student.'),/tool policy/i);
    assert.deepEqual((await active.service.agent.call('list_calendar',{student:'ana'})).events,before);
    assert.equal((await withSyntheticRuntime(active.runDirectory,()=>loadState('ana'))).plan,null);
    await manager.retire();assert.equal(await manager.current(),null);
  } finally {
    const remaining=run||await manager?.current().catch(()=>null);let closeError;
    try {await manager?.close();}catch(error){closeError=error;}
    if(remaining)for(const name of [`study-agent-${remaining.id}`,`study-calendar-${remaining.id}`])spawnSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});
    spawnSync('docker',['rm','-f',gatewayName],{stdio:'ignore',timeout:10000});
    if(remaining)for(const name of [`study-agent-net-${remaining.id}`,`study-calendar-net-${remaining.id}`])spawnSync('docker',['network','rm',name],{stdio:'ignore',timeout:10000});
    spawnSync('docker',['network','rm',gatewayNetwork],{stdio:'ignore',timeout:10000});await rm(root,{recursive:true,force:true});
    if(closeError)throw closeError;
  }
});

test('a crashed controller preserves an uncertain write and retires before replacement',
  {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:120000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-managed-crash-')),testId=randomUUID(),gatewayName=`study-test-gateway-${testId}`,gatewayNetwork=`study-test-gateway-net-${testId}`;
  const exec=promisify(execFile),docker=async(...args)=>(await exec('docker',args,{timeout:20000,maxBuffer:64000})).stdout.trim();
  let child,childExit,manager,runId,replacement,diagnostic='';
  try {
    const control=join(root,'control');await mkdir(control,{mode:0o700});const tokenFile=join(control,'gateway-token');await writeFile(tokenFile,'a'.repeat(64)+'\n',{mode:0o600});
    const agentImage=await docker('image','inspect','--format','{{.Id}}',process.env.STUDY_DSH_IMAGE||'study-dsh-agent:synthetic');
    await docker('network','create','--internal',gatewayNetwork);
    const gatewayId=await docker('run','-d','--rm','--name',gatewayName,'--label','study.role=model-gateway','--network',gatewayNetwork,
      '--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,nodev',
      '--env','STUDY_TEST_STUDENT=ana','--mount',`type=bind,source=${join(ROOT,'src')},target=/app/src,readonly`,
      '--mount',`type=bind,source=${join(ROOT,'tests/fixtures/fake-gateway-container.mjs')},target=/app/fake-gateway.mjs,readonly`,
      'node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57','node','/app/fake-gateway.mjs');
    const managerUrl=new URL('../src/foundation/exclusive-run-manager.mjs',import.meta.url).href;
    const driverUrl=new URL('../src/foundation/synthetic-run-driver.mjs',import.meta.url).href;
    const coreUrl=new URL('../src/core.mjs',import.meta.url).href;
    const source=`import {createExclusiveRunManager} from ${JSON.stringify(managerUrl)};import {createSyntheticRunDriver} from ${JSON.stringify(driverUrl)};import {loadState,withSyntheticRuntime} from ${JSON.stringify(coreUrl)};
      let run;const upstream=globalThis.fetch;globalThis.fetch=async(url,options={})=>{const response=await upstream(url,options);if(options.method==='POST'&&String(url).includes('/calendar/v3/calendars/ana-calendar/events')){console.log(JSON.stringify({stage:'sent',id:run.id}));await new Promise(()=>{});}return response;};
      let driver;const manager=await createExclusiveRunManager({root:process.argv[1],driverFactory:({lease})=>{driver=createSyntheticRunDriver({root:process.argv[1],lease,agentImage:process.argv[2],tokenFile:process.argv[3],gatewayId:process.argv[4]});return driver;}});
      run=await manager.start('ana');console.log(JSON.stringify({stage:'started',id:run.id}));const active=driver.active(run.id);let view=await active.client.prompt('Inspect and draft for the synthetic student.');while(view.busy){await new Promise(resolve=>setTimeout(resolve,50));view=await active.client.snapshot();}if(view.error)throw Error('Synthetic agent failed');const state=await withSyntheticRuntime(active.runDirectory,()=>loadState('ana'));await active.service.approvePlan(state.plan.id,'near');throw Error('Expected the synthetic response to remain interrupted');`;
    child=spawn(process.execPath,['--input-type=module','-e',source,root,agentImage,tokenFile,gatewayId],{stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-2000);});
    childExit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
    const line=await Promise.race([new Promise((resolve,reject)=>createInterface({input:child.stdout}).on('line',line=>{
      try{const marker=JSON.parse(line);if(marker.stage==='started')runId=marker.id;if(marker.stage==='sent')resolve(marker);}catch(error){reject(error);}
    })),
      childExit.then(()=>{throw new Error(`Synthetic controller exited before the write: ${diagnostic}`);}),
      new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error(`Synthetic write did not start: ${diagnostic}`)),30000);timer.unref();})]);
    assert.equal(line.stage,'sent');assert.equal(line.id,runId);
    child.kill('SIGKILL');assert.equal((await childExit).signal,'SIGKILL');
    manager=await createExclusiveRunManager({root,driverFactory:({lease})=>createSyntheticRunDriver({root,lease,agentImage,tokenFile,gatewayId})});
    assert.equal((await manager.current()).id,runId);await assert.rejects(manager.start('bruno'),/active|unresolved/i);
    const result=await manager.retire();assert.equal(result.archiveId,runId);
    const archive=JSON.parse(await readFile(join(root,'archives',`${runId}.json`),'utf8'));
    assert.equal(archive.snapshot.claim.decision.kind,'approved');assert.equal(archive.snapshot.claim.steps.at(-1).status,'sent');
    const eventId=archive.snapshot.claim.actions[0].event.id;
    assert.equal(archive.observation.availability,'available');assert.equal(archive.observation.events.filter(event=>event.id===eventId).length,1);
    assert.equal(await manager.current(),null);
    replacement=await manager.start('bruno');assert.notEqual(replacement.id,runId);await manager.retire();
  } finally {
    child?.kill('SIGKILL');await childExit?.catch(()=>{});
    const remaining=await manager?.current().catch(()=>null);let closeError;
    try{await manager?.close();}catch(error){closeError=error;}
    for(const id of [runId,replacement?.id,remaining?.id].filter(Boolean))for(const name of [`study-agent-${id}`,`study-calendar-${id}`])spawnSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});
    spawnSync('docker',['rm','-f',gatewayName],{stdio:'ignore',timeout:10000});
    for(const id of [runId,replacement?.id,remaining?.id].filter(Boolean))for(const name of [`study-agent-net-${id}`,`study-calendar-net-${id}`])spawnSync('docker',['network','rm',name],{stdio:'ignore',timeout:10000});
    spawnSync('docker',['network','rm',gatewayNetwork],{stdio:'ignore',timeout:10000});await rm(root,{recursive:true,force:true});
    if(closeError)throw closeError;
  }
});
