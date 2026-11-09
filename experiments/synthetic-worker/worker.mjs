// Disposable synthetic worker experiment. Trusted orchestrator only.
// No host workspaces, credentials, sockets, model tools or network are mounted.
import { mkdtemp, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cancellationError, runBoundedProcess } from './bounded-process.mjs';

const MAX_INPUT_BYTES=1024*1024, MAX_OUTPUT_BYTES=1024*1024, MAX_LOG_BYTES=64*1024;
const USER='65534:65534', MEMORY=256*1024*1024, NANO_CPUS=500000000;
const docker='/usr/bin/docker';
export class WorkerExitError extends Error {
  constructor(exitCode, stderr) {
    super(`Synthetic worker shell exited with code ${exitCode}; artifact was not collected`);
    this.name='WorkerExitError'; this.exitCode=exitCode;
    // Kept available only for deliberate debugging; never included in the message or JSON logs.
    Object.defineProperty(this,'stderr',{value:stderr,enumerable:false});
  }
}
function check(condition,message) { if(!condition)throw new Error(message); }

export function validateImageReference(image) {
  check(typeof image==='string'&&/^[a-zA-Z0-9._/:\-]+@sha256:[a-f0-9]{64}$/.test(image),'A digest-pinned image is required');
}
export function validateInput(files) {
  check(files&&typeof files==='object'&&!Array.isArray(files),'Synthetic files object required');
  const entries=Object.entries(files);
  check(entries.length<=100,'Too many input files'); let total=0;
  for(const [name,data] of entries) {
    check(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,99}$/.test(name),'Input files must be flat, safe names');
    check(typeof data==='string','Input file content must be text'); total+=Buffer.byteLength(data);
  }
  check(total<=MAX_INPUT_BYTES,'Synthetic inputs too large');
}
export function verifyImage(image) {
  const env=image?.Config?.Env||[], volumes=image?.Config?.Volumes||{};
  const allowed=new Set(['PATH','HOME','LANG','LC_ALL','TERM']);
  check(env.every(entry=>typeof entry==='string'&&allowed.has(entry.split('=')[0])),'Image has unexpected environment variables');
  check(Object.keys(volumes).length===0,'Image declares additional volumes');
}
export function verifyContainer(info, inputPath) {
  const h=info?.HostConfig, config=info?.Config, mounts=info?.Mounts;
  check(h&&config&&Array.isArray(mounts),'Invalid Docker inspection');
  check(h.NetworkMode==='none'&&h.ReadonlyRootfs===true&&h.Privileged===false&&['','private'].includes(h.PidMode)&&['','private'].includes(h.IpcMode),'Network, namespace, root filesystem or privilege isolation unavailable');
  check((h.Devices||[]).length===0&&(h.DeviceRequests||[]).length===0&&(h.VolumesFrom||[]).length===0,'Host devices and inherited volumes are forbidden');
  check(config.User===USER&&h.PidsLimit===64&&h.Memory===MEMORY&&h.MemorySwap===MEMORY&&h.NanoCpus===NANO_CPUS,'Configured resource or user limits unavailable');
  check(Array.isArray(h.CapDrop)&&h.CapDrop.includes('ALL')&&(h.CapAdd||[]).length===0&&Array.isArray(h.SecurityOpt)&&h.SecurityOpt.includes('no-new-privileges')&&h.SecurityOpt.every(option=>!option.includes('unconfined')),'Capability or privilege restrictions unavailable');
  check(mounts.length===1&&mounts[0].Type==='bind'&&mounts[0].Source===inputPath&&mounts[0].Destination==='/workspace'&&mounts[0].RW===false,'Unexpected mount layout');
  const temp=h.Tmpfs||{};
  const validTmpfs=(value,size)=>{
    if(typeof value!=='string')return false;const opts=new Set(value.split(','));
    return ['rw','noexec','nosuid','nodev',`size=${size}`].every(option=>opts.has(option))&&!['exec','suid','dev','ro'].some(option=>opts.has(option));
  };
  check(Object.keys(temp).length===2&&validTmpfs(temp['/tmp'],'16m')&&validTmpfs(temp['/output'],'8m'),'Bounded, restricted temporary filesystems unavailable');
  check(JSON.stringify(config.Entrypoint)==='["/bin/bash"]'&&JSON.stringify(config.Cmd)==='["-c","exec /bin/sleep 60"]'&&config.WorkingDir==='/workspace','Unexpected shell, keepalive or workspace');
}

export function dockerInvocation(context,args) {
  return {args:['--config',context.config,...args],env:{PATH:'/usr/bin:/bin',HOME:context.home,DOCKER_CONFIG:context.config,DOCKER_HOST:`unix://${context.socket}`}};
}
function throwIfCancelled(signal) {if(signal?.aborted)throw cancellationError();}
function call(context,args,{timeout=10000,maxBytes=MAX_LOG_BYTES,signal}={}) {
  const invocation=dockerInvocation(context,args);
  return runBoundedProcess(docker,invocation.args,{env:invocation.env,timeout,maxBytes,signal});
}
async function checked(context,args,options) {
  const result=await call(context,args,options);
  if(result.code!==0)throw new Error(`Docker ${args[0]} failed (exit ${result.code})`);
  return result.stdout;
}
function parseOctal(data) {
  const text=data.toString('ascii').replace(/\0.*$/,'').trim();
  check(/^[0-7]+$/.test(text),'Unsupported tar numeric field');
  return parseInt(text,8);
}
export function readResultTar(buffer) {
  check(Buffer.isBuffer(buffer)&&buffer.length>=1024,'Invalid result archive');
  const header=buffer.subarray(0,512);
  const name=header.subarray(0,100).toString('utf8').replace(/\0.*$/,'').replace(/^\.\//,'');
  const type=header[156],length=parseOctal(header.subarray(124,136));
  const stored=parseOctal(header.subarray(148,156));
  let checksum=0;for(let i=0;i<512;i++)checksum+=i>=148&&i<156?32:header[i];
  const prefix=header.subarray(345,500).toString('utf8').replace(/\0.*$/,'');
  check(checksum===stored&&prefix===''&&name==='result.txt'&&(type===0||type===48),'Only a single regular result.txt artifact is accepted');
  check(length<=MAX_OUTPUT_BYTES&&buffer.length>=512+Math.ceil(length/512)*512+1024,'Result exceeds output limit or archive is truncated');
  const end=512+Math.ceil(length/512)*512;
  check(buffer.subarray(end).every(byte=>byte===0),'Additional archive entries are forbidden');
  return buffer.subarray(512,512+length);
}

/** Return absent only after an authoritative absent response and a healthy daemon.
 * A timed-out create may complete after an absence check, so stays unknown. */
export function classifyCleanup({removed,absent,daemonReachable,createState}) {
  if(removed)return 'removed';
  if(absent&&daemonReachable&&createState==='created')return 'absent';
  return 'unknown';
}

async function cleanupContainer(context,name,createState) {
  try {await checked(context,['rm','--force',name]);return 'removed';}catch {}
  try {
    const inspected=await call(context,['inspect',name]);
    const absent=inspected.code!==0&&/no such (object|container)/i.test(inspected.stderr.toString('utf8'));
    let daemonReachable=false;
    try {await checked(context,['version','--format','{{.Server.Version}}']);daemonReachable=true;}catch {}
    return classifyCleanup({removed:false,absent,daemonReachable,createState});
  } catch {return 'unknown';}
}
async function recordUnknownCleanup(name,socket,createState) {
  const dir=join(tmpdir(),'synthetic-worker-incidents-v1');
  await mkdir(dir,{recursive:true,mode:0o700});
  const info=await lstat(dir);
  check(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&(!process.getuid||info.uid===process.getuid()),'Incident directory is not private');
  const path=join(dir,`${name}.json`);
  await writeFile(path,JSON.stringify({schemaVersion:1,runName:name,dockerSocket:socket,createState,observedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
  return path;
}

/** Independent cleanup steps preserve the incident even when local removal fails. */
export async function finalizeCleanup({createState,removeContainer,removeRoot,recordIncident}) {
  let containerStatus='not-needed',rootCleanupFailed=false,rootCleanupErrorCode=null,incidentPath=null,incidentWriteFailed=false;
  if(createState!=='not-started') {
    try {containerStatus=await removeContainer();}catch {containerStatus='unknown';}
    if(!['removed','absent','unknown'].includes(containerStatus))containerStatus='unknown';
  }
  try {await removeRoot();}catch(error) {rootCleanupFailed=true;rootCleanupErrorCode=typeof error?.code==='string'?error.code:null;}
  if(containerStatus==='unknown') {
    try {incidentPath=await recordIncident();}catch {incidentWriteFailed=true;}
  }
  return {containerStatus,rootCleanupFailed,rootCleanupErrorCode,incidentPath,incidentWriteFailed};
}

/** Runs fictional inputs only, with a trusted locally available pinned image. */
export async function runSyntheticWorker({image,files,script,timeoutMs=5000,dockerSocket='/var/run/docker.sock',signal}) {
  validateImageReference(image);validateInput(files);
  check(typeof script==='string'&&Buffer.byteLength(script)<=16384,'Script must be bounded text');
  check(Number.isInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=30000,'Invalid timeout');
  check(typeof dockerSocket==='string'&&isAbsolute(dockerSocket)&&!/[\r\n]/.test(dockerSocket),'An explicit local Unix Docker socket is required');
  check(signal===undefined||signal instanceof AbortSignal,'Invalid cancellation signal');
  throwIfCancelled(signal);
  const root=await mkdtemp(join(tmpdir(),'synthetic-worker-')), input=join(root,'workspace');
  const context={home:root,config:join(root,'docker-config'),socket:dockerSocket};
  const name=`synthetic-worker-${randomUUID()}`; let createState='not-started', result, primaryError, cleanup;
  try {
    await mkdir(context.config,{mode:0o700});
    await writeFile(join(context.config,'config.json'),'{}',{mode:0o600,flag:'wx'});
    throwIfCancelled(signal);
    const imageInfo=JSON.parse((await checked(context,['image','inspect',image],{signal})).toString('utf8'));
    check(Array.isArray(imageInfo)&&imageInfo.length===1,'Image inspection failed');verifyImage(imageInfo[0]);
    await mkdir(input,{mode:0o755});
    for(const [filename,content] of Object.entries(files))await writeFile(join(input,filename),content,{mode:0o444,flag:'wx'});
    const args=['create','--pull=never','--name',name,'--network=none','--read-only','--user',USER,
      '--ipc=private','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=256m','--memory-swap=256m','--cpus=0.5',
      '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m','--tmpfs','/output:rw,noexec,nosuid,nodev,size=8m,mode=1777',
      '--mount',`type=bind,source=${input},target=/workspace,readonly`, '--workdir','/workspace',
      '--env','HOME=/tmp','--env','PATH=/usr/bin:/bin','--no-healthcheck','--entrypoint','/bin/bash',image,'-c','exec /bin/sleep 60'];
    throwIfCancelled(signal);
    createState='ambiguous'; await checked(context,args,{signal}); createState='created';
    const info=JSON.parse((await checked(context,['inspect',name],{signal})).toString('utf8'));verifyContainer(info[0],input);
    await checked(context,['start',name],{signal});
    const started=await call(context,['exec',name,'/bin/bash','-c',script],{timeout:timeoutMs,maxBytes:MAX_LOG_BYTES,signal});
    check(started.code!==null,'Shell process terminated without an exit code');
    if(started.code!==0)throw new WorkerExitError(started.code,started.stderr.toString('utf8'));
    const output=await checked(context,['exec',name,'/bin/tar','--format=ustar','-C','/output','-cf','-','--','result.txt'],{maxBytes:MAX_OUTPUT_BYTES+128*1024,signal});
    throwIfCancelled(signal);
    result={runName:name,exitCode:started.code,stdout:started.stdout.toString('utf8'),stderr:started.stderr.toString('utf8'),artifact:readResultTar(output)};
  } catch(error) {primaryError=error;}
  finally {
    cleanup=await finalizeCleanup({createState,
      removeContainer:()=>cleanupContainer(context,name,createState),
      removeRoot:()=>rm(root,{recursive:true,force:true}),
      recordIncident:()=>recordUnknownCleanup(name,dockerSocket,createState)});
  }
  if(cleanup.containerStatus==='unknown') {
    const error=new Error(`Container cleanup is unknown for ${name}; reconciliation required`);
    error.name='WorkerCleanupError';error.runName=name;error.dockerSocket=dockerSocket;
    error.incidentPath=cleanup.incidentPath;error.incidentWriteFailed=cleanup.incidentWriteFailed;
    error.rootCleanupFailed=cleanup.rootCleanupFailed;error.rootCleanupErrorCode=cleanup.rootCleanupErrorCode;
    if(cleanup.rootCleanupFailed)error.rootPath=root;
    if(primaryError)error.originalFailureName=primaryError.name;
    throw error;
  }
  if(cleanup.rootCleanupFailed) {
    const error=new Error(`Synthetic worker input cleanup failed for ${name}`);
    error.name='WorkerLocalCleanupError';error.runName=name;error.containerStatus=cleanup.containerStatus;error.rootPath=root;error.rootCleanupErrorCode=cleanup.rootCleanupErrorCode;
    if(primaryError)error.originalFailureName=primaryError.name;
    throw error;
  }
  if(primaryError)throw primaryError;
  throwIfCancelled(signal);
  return result;
}
