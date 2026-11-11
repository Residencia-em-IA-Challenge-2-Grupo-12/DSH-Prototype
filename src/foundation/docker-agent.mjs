import {execFile,spawn} from 'node:child_process';
import {constants,promises as fs} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {createAgentControlClient} from './agent-control-client.mjs';
import {createStudyBrokerClient} from './study-broker.mjs';

const exec=promisify(execFile);
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function inspectDockerNetwork(name){
  const {stdout}=await exec('docker',['network','inspect','--format','{{json .}}',name],{timeout:10000,maxBuffer:64000});
  return JSON.parse(stdout);
}
function requirePrivate(stat,kind){
  if((stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid())||!kind(stat))throw new Error('Agent control files must be private and owned by the current user');
}

// The trusted lifecycle owns Docker and supplies a pre-reserved run ID. This
// launcher never mounts the provider key, host workspace or Docker socket.
// A successful spawn is not proof of cleanup; retirement must be verified by
// the lifecycle controller even after this control process exits.
export async function startDockerAgent({runId,student,runDirectory,tokenFile,image,route='deepseek',
  inspectNetwork=inspectDockerNetwork,launch=spawn}={}){
  if(typeof runId!=='string'||!idPattern.test(runId))throw new Error('A reserved synthetic run ID is required');
  if(!['ana','bruno'].includes(student))throw new Error('Unknown synthetic student');
  if(route!=='deepseek')throw new Error('Only the gateway comparison route is wired in this launcher');
  if(typeof image!=='string'||!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('An immutable local agent image ID is required');
  if(typeof runDirectory!=='string'||!path.isAbsolute(runDirectory)||path.normalize(runDirectory)!==runDirectory||runDirectory.includes(','))throw new Error('A valid private run directory is required');
  if(typeof tokenFile!=='string'||!path.isAbsolute(tokenFile)||path.normalize(tokenFile)!==tokenFile||tokenFile.includes(','))throw new Error('A valid gateway control file is required');
  if(!process.getuid||process.getuid()===0||!process.getgid)throw new Error('A non-root trusted launcher is required');
  const ipc=path.join(runDirectory,'ipc'),socketPath=path.join(ipc,'agent.sock');
  requirePrivate(await fs.lstat(runDirectory),stat=>stat.isDirectory());
  requirePrivate(await fs.lstat(ipc),stat=>stat.isDirectory());
  requirePrivate(await fs.lstat(socketPath),stat=>stat.isSocket());
  const file=await fs.open(tokenFile,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=await file.stat();requirePrivate(stat,value=>value.isFile()&&value.size<=128);
    if(!/^[a-f0-9]{64}$/.test((await file.readFile('utf8')).trim()))throw new Error('Invalid gateway control credential');
  } finally {await file.close();}
  if(await createStudyBrokerClient({socketPath}).ping()!==true)throw new Error('Synthetic study broker is unavailable');
  const network=`study-agent-net-${runId}`,observed=await inspectNetwork(network);
  if(observed?.Name!==network||observed.Internal!==true||observed.Labels?.['study.run.id']!==runId)throw new Error('Synthetic agent network identity or isolation is invalid');
  const name=`study-agent-${runId}`;
  const args=['run','-i','--rm','--name',name,'--label',`study.run.id=${runId}`,'--network',network,
    '--user',`${process.getuid()}:${process.getgid()}`,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '--tmpfs','/tmp:rw,nosuid,nodev,noexec','--memory','768m','--cpus','1','--pids-limit','256',
    '--env','STUDY_ATLAS_RUNTIME_DIR=/tmp/study-runtime','--env',`STUDY_STUDENT=${student}`,'--env','STUDY_AGENT_ROUTE=deepseek',
    '--mount',`type=bind,source=${ipc},target=/run/study-broker,readonly`,
    '--mount',`type=bind,source=${tokenFile},target=/run/study-control/gateway-token,readonly`,image];
  const child=launch('docker',args,{stdio:['pipe','pipe','pipe']});child.stderr?.resume();
  return {runId,name,network,child,client:createAgentControlClient({child})};
}
