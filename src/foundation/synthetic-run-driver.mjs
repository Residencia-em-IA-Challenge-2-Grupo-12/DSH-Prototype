import {execFile} from 'node:child_process';
import {constants,promises as fs} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {ROOT,initializeScenario,withSyntheticRuntime} from '../core.mjs';
import {createStateStore} from '../state-store.mjs';
import {startCalendarpitRun,inspectCalendarpitRun} from './calendarpit-runner.mjs';
import {authorizeSyntheticCalendar} from './synthetic-calendar-auth.mjs';
import {createClaimedCalendar} from './claimed-calendar.mjs';
import {createTrustedStudyService} from './trusted-study-service.mjs';
import {startStudyBroker} from './study-broker.mjs';
import {startDockerAgent} from './docker-agent.mjs';
import {attachRunGateway,detachRunGateway} from './docker-gateway.mjs';
import {inspectDockerAgent,inspectDockerCalendar,inspectDockerNetwork,retireDockerAgent,retireDockerCalendar,retireDockerNetwork} from './docker-retirement.mjs';
import {archiveSyntheticRun} from './run-archive.mjs';
import {createExperimentTrace} from './experiment-trace.mjs';
import {createExperimentSession} from './experiment-session.mjs';

const exec=promisify(execFile);
const docker=async(...args)=>(await exec('docker',args,{timeout:20000,maxBuffer:64000})).stdout.trim();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const imageId=/^sha256:[a-f0-9]{64}$/,containerId=/^[a-f0-9]{64}$/;
const redirectUri='http://127.0.0.1:4175/callback';

async function syncDirectory(directory){const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
async function waitForExit(child){
  if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise((resolve,reject)=>{
    const finish=()=>{clearTimeout(timer);child.off('error',fail);resolve();};
    const fail=()=>{clearTimeout(timer);child.off('exit',finish);reject(new Error('Agent control process failed'));};
    const timer=setTimeout(()=>{child.off('exit',finish);child.off('error',fail);reject(new Error('Agent control process did not stop; retirement is unverified'));},15000);
    child.once('exit',finish);child.once('error',fail);
  });
}

// Trusted host controller for the synthetic comparison. It uses a pre-existing
// labelled gateway and never gives the agent a provider key or Docker socket.
// It does not yet resume interrupted startup/retirement or power the web UI.
export function createSyntheticRunDriver({root,lease,agentImage,tokenFile,gatewayId,runDocker=docker}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root)throw new Error('A valid lifecycle root is required');
  if(typeof lease?.assertHeld!=='function')throw new Error('An exclusive controller lease is required');
  if(!imageId.test(agentImage||'')||!containerId.test(gatewayId||''))throw new Error('Immutable agent image and gateway container IDs are required');
  if(typeof tokenFile!=='string'||!path.isAbsolute(tokenFile)||typeof runDocker!=='function')throw new Error('Trusted gateway configuration is required');
  let current=null;
  const runDirectory=run=>{
    if(!uuid.test(run?.id||'')||!['ana','bruno'].includes(run?.student))throw new Error('Invalid synthetic run identity');
    return path.join(root,'runs',run.id);
  };
  async function manifest(run){
    const directory=runDirectory(run),file=path.join(directory,'run-manifest.json');
    const info=await fs.lstat(file);if(!info.isFile()||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid())||info.size>4096)throw new Error('Synthetic run manifest is invalid');
    const value=JSON.parse(await fs.readFile(file,'utf8'));
    if(value.version!==1||value.id!==run.id||value.student!==run.student||!containerId.test(value.gatewayId||'')||!imageId.test(value.agentImage||''))throw new Error('Synthetic run manifest identity does not match');
    return value;
  }
  async function stopWriters(run,{force=false}={}){
    lease.assertHeld();
    if(run.retireFromPhase==='start-failed')throw new Error('Startup resource outcome is unknown; managed retirement is blocked');
    const details=await manifest(run),owned=current?.id===run.id?current:null;
    if(owned?.service)await owned.service.drain({force});
    if(owned?.agent){owned.agent.client.close();await waitForExit(owned.agent.child);}
    await retireDockerAgent({runId:run.id,lease,runDocker,force});
    await detachRunGateway({runId:run.id,gatewayId:details.gatewayId,lease,runDocker});
    await retireDockerNetwork({runId:run.id,kind:'agent',lease,runDocker});
    if(owned?.broker){await owned.broker.close();owned.broker=null;}
    if(owned)owned.quiesced=true;
  }
  return {
    active(id){
      if(!current||current.id!==id||!current.ready||current.quiesced)return null;
      return {id:current.id,student:current.student,runDirectory:current.runDirectory,service:current.service,client:current.client};
    },
    async start(run){
      lease.assertHeld();const directory=runDirectory(run),runs=path.dirname(directory);
      await fs.mkdir(runs,{recursive:true,mode:0o700});await fs.mkdir(directory,{mode:0o700});
      current={id:run.id,student:run.student,runDirectory:directory,ready:false,quiesced:false};
      const file=await fs.open(path.join(directory,'run-manifest.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      try{await file.writeFile(JSON.stringify({version:1,id:run.id,student:run.student,gatewayId,agentImage})+'\n');await file.sync();}finally{await file.close();}
      await syncDirectory(directory);await syncDirectory(runs);
      const fixtureText=await fs.readFile(path.join(ROOT,'fixtures/calendars',`${run.student}.json`),'utf8');
      const fixture=JSON.parse(fixtureText),attemptId=randomUUID(),traceDirectory=path.join(directory,'experiments',attemptId);
      await fs.mkdir(traceDirectory,{recursive:true,mode:0o700});
      const trace=await createExperimentTrace({directory:traceDirectory,runId:run.id,attemptId});current.trace=trace;
      await trace.append('configuration',{student:run.student,fixtureSha256:createHash('sha256').update(fixtureText).digest('hex'),agentImage,route:'gateway',usage:'unknown'});
      const simulator=await startCalendarpitRun({fixture,redirectUri,runId:run.id,runDirectory:directory,runDocker});current.simulator=simulator;
      const accessToken=await authorizeSyntheticCalendar({run:simulator,student:run.student,redirectUri});
      const store=createStateStore(directory);
      const calendar=createClaimedCalendar({origin:simulator.origin,accessToken,getClaim:()=>store.getCalendarClaim()});current.calendar=calendar;
      await withSyntheticRuntime(directory,()=>initializeScenario(calendar,run.student));
      const service=createTrustedStudyService({student:run.student,calendar,runtimeDirectory:directory,trace});current.service=service;
      const ipc=path.join(directory,'ipc');await fs.mkdir(ipc,{mode:0o700});
      current.broker=await startStudyBroker({socketPath:path.join(ipc,'agent.sock'),boundary:service.agent});
      lease.assertHeld();await runDocker('network','create','--internal','--label',`study.run.id=${run.id}`,`study-agent-net-${run.id}`);
      await attachRunGateway({runId:run.id,gatewayId,lease,runDocker});
      current.agent=await startDockerAgent({runId:run.id,student:run.student,runDirectory:directory,tokenFile,image:agentImage});
      current.client=createExperimentSession({client:current.agent.client,trace});
      const initial=await current.client.snapshot();
      if(initial?.student!==run.student)throw new Error('Synthetic agent did not report the selected student');
      current.ready=true;
    },
    stopWriters,
    async archive(run){
      lease.assertHeld();const directory=runDirectory(run);await manifest(run);
      const owned=current?.id===run.id?current:null;
      if(owned&&!owned.quiesced)throw new Error('Synthetic run has not been drained');
      if(owned?.trace&&!owned.trace.healthy())throw new Error('Synthetic experiment evidence could not be persisted');
      const store=createStateStore(directory);
      const stateFile=await fs.lstat(path.join(directory,'state.sqlite'));
      if(!stateFile.isFile())throw new Error('Synthetic run state is unavailable');
      const snapshot=owned?.service?await owned.service.snapshotForArchive():await store.snapshotForArchive(run.student);
      let events=null;
      try {
        let calendar=owned?.calendar;
        if(!calendar){
          const simulator=await inspectCalendarpitRun({runId:run.id,student:run.student,runDirectory:directory,runDocker});
          const accessToken=await authorizeSyntheticCalendar({run:simulator,student:run.student,redirectUri});
          calendar=createClaimedCalendar({origin:simulator.origin,accessToken,getClaim:()=>store.getCalendarClaim()});
        }
        events=await calendar.events(run.student);
      } catch { /* An unavailable observation stays explicitly unknown. */ }
      return archiveSyntheticRun({directory:path.join(root,'archives'),run,snapshot,
        observation:events?{availability:'available',events}:{availability:'unavailable',events:null}});
    },
    async stopSimulator(run){
      lease.assertHeld();await manifest(run);
      await retireDockerCalendar({runId:run.id,lease,runDocker});
      await retireDockerNetwork({runId:run.id,kind:'calendar',lease,runDocker});
    },
    async verifyRetired(run){
      lease.assertHeld();await manifest(run);
      const resources=await Promise.all([inspectDockerAgent({runId:run.id,lease,runDocker}),inspectDockerCalendar({runId:run.id,lease,runDocker}),
        inspectDockerNetwork({runId:run.id,kind:'agent',lease,runDocker}),inspectDockerNetwork({runId:run.id,kind:'calendar',lease,runDocker})]);
      if(resources.some(resource=>resource.state!=='absent'))return false;
      if(current?.id===run.id)current=null;
      return true;
    },
    async shutdown(){if(current)await stopWriters({id:current.id,student:current.student,retireFromPhase:current.ready?'active':'start-failed'});}
  };
}
