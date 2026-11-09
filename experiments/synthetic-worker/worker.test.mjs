import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { finalizeCleanup, dockerInvocation, classifyCleanup, WorkerExitError, validateImageReference, validateInput, verifyImage, verifyContainer, readResultTar, runSyntheticWorker } from './worker.mjs';

const image='local-test@sha256:'+ 'a'.repeat(64);
const inspection = () => ({Config:{User:'65534:65534',Entrypoint:['/bin/bash'],Cmd:['-c','exec /bin/sleep 60'],WorkingDir:'/workspace'},
  HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,PidMode:'',IpcMode:'private',PidsLimit:64,Memory:268435456,MemorySwap:268435456,NanoCpus:500000000,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],Tmpfs:{'/tmp':'rw,noexec,nosuid,nodev,size=16m','/output':'rw,noexec,nosuid,nodev,size=8m,mode=1777'}},
  Mounts:[{Type:'bind',Source:'/tmp/test-workspace',Destination:'/workspace',RW:false}]});
function tar(name,content,type=48,prefix='') {
  const h=Buffer.alloc(512);h.write(name);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);
  h.write(content.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h[156]=type;
  h.write(prefix,345);h.write(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);
  const body=Buffer.alloc(Math.ceil(content.length/512)*512);content.copy(body);return Buffer.concat([h,body,Buffer.alloc(1024)]);
}

test('validates image, input and refuses weakened isolation',()=>{
  validateImageReference(image);assert.throws(()=>validateImageReference('bash:latest'),/digest-pinned/);
  validateInput({'course.txt':'fiction'});assert.throws(()=>validateInput({'../secret':'x'}),/safe names/);
  verifyImage({Config:{Env:['PATH=/bin','LANG=C'],Volumes:{}}});assert.throws(()=>verifyImage({Config:{Env:['SECRET=x']}}),/environment/);
  const expected=inspection();verifyContainer(expected,'/tmp/test-workspace');
  for(const mutate of [x=>x.HostConfig.NetworkMode='bridge',x=>delete x.HostConfig.PidMode,x=>delete x.HostConfig.IpcMode,x=>x.HostConfig.PidMode='container:shared',x=>x.HostConfig.IpcMode='container:shared',x=>x.HostConfig.IpcMode='shareable',x=>x.HostConfig.Tmpfs['/tmp']='rw,exec,suid,dev,size=16m',x=>x.HostConfig.Tmpfs['/output']='rw,noexec,nosuid,size=8m',x=>x.HostConfig.ReadonlyRootfs=false,x=>x.Config.User='0:0',x=>x.Mounts[0].RW=true,x=>x.Mounts.push({Destination:'/var/run/docker.sock'}),x=>x.HostConfig.Memory=0,x=>delete x.HostConfig.Tmpfs['/output']]) {
    const value=inspection();mutate(value);assert.throws(()=>verifyContainer(value,'/tmp/test-workspace'));
  }
});
test('rejects symlinks, traversal, oversized and extra tar members',()=>{
  assert.equal(readResultTar(tar('result.txt',Buffer.from('synthetic'))).toString(),'synthetic');
  assert.throws(()=>readResultTar(tar('result.txt',Buffer.alloc(0),50)),/regular/);
  assert.throws(()=>readResultTar(tar('../result.txt',Buffer.from('x'))),/regular/);
  assert.throws(()=>readResultTar(tar('result.txt',Buffer.from('x'),48,'../../host')),/regular/);
  assert.throws(()=>readResultTar(tar('result.txt',Buffer.alloc(1024*1024+1))),/limit/);
  const archive=tar('result.txt',Buffer.from('x'));archive[1024]=1;assert.throws(()=>readResultTar(archive),/Additional/);
});
test('Docker uses a private config and cleanup distinguishes ambiguous create',()=>{
  const invocation=dockerInvocation({home:'/tmp/private/run',config:'/tmp/private/run/config',socket:'/var/run/docker.sock'},['info']);
  assert.deepEqual(invocation.args,['--config','/tmp/private/run/config','info']);
  assert.equal(invocation.env.HOME,'/tmp/private/run');assert.equal(invocation.env.DOCKER_HOST,'unix:///var/run/docker.sock');
  assert.equal(invocation.env.DOCKER_CONTEXT,undefined);assert.equal(invocation.env.DOCKER_TLS_VERIFY,undefined);
  assert.equal(classifyCleanup({removed:true,createState:'ambiguous'}),'removed');
  assert.equal(classifyCleanup({removed:false,absent:true,daemonReachable:true,createState:'created'}),'absent');
  assert.equal(classifyCleanup({removed:false,absent:true,daemonReachable:true,createState:'ambiguous'}),'unknown');
  assert.equal(classifyCleanup({removed:false,absent:true,daemonReachable:false,createState:'created'}),'unknown');
});
test('unknown container incident survives failed local cleanup',async()=>{
  let recorded=false;
  const outcome=await finalizeCleanup({createState:'ambiguous',
    removeContainer:async()=>{throw Error('daemon unavailable');},
    removeRoot:async()=>{throw Object.assign(Error('cannot remove local inputs'),{code:'EACCES'});},
    recordIncident:async()=>{recorded=true;return '/tmp/incident';}});
  assert.deepEqual(outcome,{containerStatus:'unknown',rootCleanupFailed:true,rootCleanupErrorCode:'EACCES',incidentPath:'/tmp/incident',incidentWriteFailed:false});
  assert.equal(recorded,true);
  const bothFail=await finalizeCleanup({createState:'created',removeContainer:async()=>{throw Error();},removeRoot:async()=>{throw Error();},recordIncident:async()=>{throw Error();}});
  assert.equal(bothFail.containerStatus,'unknown');assert.equal(bothFail.rootCleanupFailed,true);assert.equal(bothFail.incidentWriteFailed,true);
});
test('shell errors do not expose captured stderr in normal logs',()=>{
  const error=new WorkerExitError(7,'synthetic-sensitive-stderr');
  assert.equal(error.exitCode,7);assert.doesNotMatch(JSON.stringify(error),/synthetic-sensitive-stderr/);
  assert.doesNotMatch(error.message,/synthetic-sensitive-stderr/);
});
test('without a pinned image, no worker is started',async()=>{
  await assert.rejects(runSyntheticWorker({image:'latest',files:{},script:'true'}),/digest-pinned/);
});

test('already cancelled work is rejected before creating local state',async()=>{
  const before=new Set((await readdir(tmpdir())).filter(name=>name.startsWith('synthetic-worker-')));
  const controller=new AbortController();controller.abort('do not expose this reason');
  await assert.rejects(runSyntheticWorker({image,files:{},script:'true',signal:controller.signal}),error=>error.name==='AbortError'&&!error.message.includes('do not expose'));
  const after=new Set((await readdir(tmpdir())).filter(name=>name.startsWith('synthetic-worker-')));
  assert.deepEqual([...after].filter(name=>!before.has(name)),[]);
  await assert.rejects(runSyntheticWorker({image,files:{},script:'true',signal:{aborted:false}}),/Invalid cancellation signal/);
});

const imageUnderTest=process.env.SYNTHETIC_WORKER_TEST_IMAGE;
test('disposable worker enforces isolation, timeout, output limits and cleanup', {skip:!imageUnderTest,timeout:120000},async()=>{
  // The canary is synthetic and never mounted. No local user data is used.
  const canary=join(tmpdir(),`worker-canary-${randomUUID()}`);await writeFile(canary,'synthetic-canary');
  const docker=promisify(execFile);
  const containers=async()=>new Set((await docker('/usr/bin/docker',['ps','--all','--quiet','--filter','name=synthetic-worker-'])).stdout.trim().split(/\s+/).filter(Boolean));
  const dirs=async()=>new Set((await readdir(tmpdir())).filter(name=>name.startsWith('synthetic-worker-')));
  const originalContainers=await containers(), originalDirs=await dirs();
  try {
    const script=`set -eu
[[ $EUID -eq 65534 ]]
IFS= read -r value < /workspace/lesson.txt
[[ "$value" == fictional ]]
if ( : > /workspace/lesson.txt ) 2>/dev/null; then exit 2; fi
if ( : > /worker-root-canary ) 2>/dev/null; then exit 3; fi
[[ ! -e /var/run/docker.sock ]]
[[ ! -e "${canary}" ]]
if ( printf x > /dev/tcp/1.1.1.1/53 ) 2>/dev/null; then exit 4; fi
printf 'synthetic result' > /output/result.txt`;
    const result=await runSyntheticWorker({image:imageUnderTest,files:{'lesson.txt':'fictional\n'},script});
    assert.equal(result.exitCode,0);assert.equal(result.artifact.toString(),'synthetic result');
    assert.equal((await readFile(canary,'utf8')),'synthetic-canary');
    await assert.rejects(runSyntheticWorker({image:imageUnderTest,files:{},script:'exit 7'}),e=>e instanceof WorkerExitError && e.exitCode===7);
    await assert.rejects(runSyntheticWorker({image:imageUnderTest,files:{},script:'while :; do :; done',timeoutMs:500}),/timed out/);
    await assert.rejects(runSyntheticWorker({image:imageUnderTest,files:{},script:'while :; do printf 1234567890; done'}),/Output limit exceeded/);
    await assert.rejects(runSyntheticWorker({image:imageUnderTest,files:{},script:'ln -s /etc/passwd /output/result.txt'}),/regular|archive|Output|Docker cp/);
    assert.deepEqual([...await containers()].filter(id=>!originalContainers.has(id)),[],'worker containers cleaned up');
    assert.deepEqual([...await dirs()].filter(name=>!originalDirs.has(name)),[],'synthetic input directories cleaned up');
  } finally {await rm(canary,{force:true});}
});


test('cancellation stops a running worker and confirms cleanup', {skip:!imageUnderTest,timeout:30000},async()=>{
  const docker=promisify(execFile);
  const list=async()=>new Set((await docker('/usr/bin/docker',['ps','--all','--quiet','--filter','name=synthetic-worker-'])).stdout.trim().split(/\s+/).filter(Boolean));
  const baseline=await list();
  const originalDirs=new Set((await readdir(tmpdir())).filter(name=>name.startsWith('synthetic-worker-')));
  const controller=new AbortController();
  const promise=runSyntheticWorker({image:imageUnderTest,files:{},script:'printf ready > /output/started; while :; do :; done',timeoutMs:30000,signal:controller.signal});
  promise.catch(()=>{});
  let observed=false;
  try {
    const deadline=Date.now()+12000;
    while(Date.now()<deadline&&!observed){
      for(const id of await list())if(!baseline.has(id)){
        try {await docker('/usr/bin/docker',['exec',id,'/bin/bash','-c','test -f /output/started']);observed=true;}catch {}
      }
      if(!observed)await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(observed,'worker did not reach running script');
    const started=Date.now();controller.abort();
    await assert.rejects(promise,error=>error.name==='AbortError');
    assert.ok(Date.now()-started<10000,'cancellation and cleanup exceeded test bound');
    assert.deepEqual([...await list()].filter(id=>!baseline.has(id)),[],'cancelled container remains');
    assert.deepEqual((await readdir(tmpdir())).filter(name=>name.startsWith('synthetic-worker-')&&!originalDirs.has(name)),[],'cancelled input directory remains');
  } finally {controller.abort();await promise.catch(()=>{});}
});
