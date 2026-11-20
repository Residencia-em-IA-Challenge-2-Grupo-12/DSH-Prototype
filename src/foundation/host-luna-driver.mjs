import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ROOT,initializeScenario,withSyntheticRuntime,disposeSyntheticRuntime} from '../core.mjs';
import {StudySession} from '../sdk-session.mjs';
import {createStateStore} from '../state-store.mjs';
import {startCalendarpitRun} from './calendarpit-runner.mjs';
import {authorizeSyntheticCalendar} from './synthetic-calendar-auth.mjs';
import {createClaimedCalendar} from './claimed-calendar.mjs';
import {createTrustedStudyService} from './trusted-study-service.mjs';
import {startStudyBroker} from './study-broker.mjs';
import {createExperimentTrace} from './experiment-trace.mjs';
import {createExperimentSession} from './experiment-session.mjs';
import {archiveSyntheticRun} from './run-archive.mjs';
import {inspectDockerCalendar,inspectDockerNetwork,retireDockerCalendar,retireDockerNetwork} from './docker-retirement.mjs';

async function exited(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);resolve();};
    const timer=setTimeout(()=>{child.off('exit',done);reject(Error('Host agent termination is unverified'));},15000);
    child.once('exit',done);
  });
}

// Explicit synthetic fallback: DSH/controller remain on the host; Calendarpit
// alone is containerized. Restart inspection blocks rather than reconstructing
// or trusting an old host process. No credential paths enter API responses.
export function createHostLunaDriver({root,lease,dshHome,sessionFactory=options=>new StudySession('bruno',options),authorizeCalendar=authorizeSyntheticCalendar}={}){
  if(!path.isAbsolute(root||'')||!path.isAbsolute(dshHome||'')||!lease?.assertHeld)throw Error('Trusted absolute runtime/profile and controller lease required');
  if(typeof authorizeCalendar!=='function')throw Error('Trusted synthetic calendar authorization is required');
  if(dshHome===root||dshHome.startsWith(root+path.sep))throw Error('Persistent login must remain outside disposable runs');
  let current;
  const owned=run=>{
    lease.assertHeld();
    if(!current||current.id!==run.id||current.student!==run.student)throw Error('Old host writer identity is unverified; preserve this run for facilitator inspection');
    return current;
  };
  return {
    active(id){return current?.id===id&&current.ready&&!current.stopped?current:null;},
    async start(run){
      lease.assertHeld();
      if(run.student!=='bruno')throw Error('This bounded host walkthrough supports Bruno only');
      if(current)throw Error('Previous host run has not been verified retired');
      const directory=path.join(root,'runs',run.id);
      await mkdir(directory,{recursive:true,mode:0o700});
      const attemptId=randomUUID(),traceDirectory=path.join(directory,'experiments',attemptId);
      await mkdir(traceDirectory,{recursive:true,mode:0o700});
      current={id:run.id,student:run.student,runDirectory:directory,ready:false,stopped:false};
      await writeFile(path.join(directory,'host-runtime.json'),JSON.stringify({version:1,runId:run.id,runtime:'host-luna-fallback',controllerPid:process.pid,restartRecovery:'blocked-until-host-writers-verified'})+'\n',{mode:0o600,flag:'wx'});
      const trace=await createExperimentTrace({directory:traceDirectory,runId:run.id,attemptId});current.trace=trace;
      const fixture=await readFile(path.join(ROOT,'fixtures/calendars/bruno.json'),'utf8');
      await trace.append('configuration',{runtime:'host-luna-fallback',provider:'codex',model:'gpt-6-luna',harness:'0.2.2-rc.1',fixedDate:'2026-11-02',fixtureSha256:createHash('sha256').update(fixture).digest('hex'),usage:'unknown'});
      current.simulator=await startCalendarpitRun({fixture:JSON.parse(fixture),redirectUri:'http://127.0.0.1:4175/callback',runId:run.id,runDirectory:directory});
      const accessToken=await authorizeCalendar({run:current.simulator,student:'bruno',redirectUri:'http://127.0.0.1:4175/callback'});
      const store=createStateStore(directory);current.store=store;
      current.calendar=createClaimedCalendar({origin:current.simulator.origin,accessToken,getClaim:()=>store.getCalendarClaim()});
      await withSyntheticRuntime(directory,()=>initializeScenario(current.calendar,'bruno'));
      current.service=createTrustedStudyService({student:'bruno',calendar:current.calendar,runtimeDirectory:directory,trace});
      const ipc=path.join(directory,'ipc');await mkdir(ipc,{mode:0o700});
      const socketPath=path.join(ipc,'agent.sock');
      current.broker=await startStudyBroker({socketPath,boundary:current.service.agent});
      current.session=sessionFactory({dshHome,brokerSocket:socketPath});
      const session=current.session;
      current.client=createExperimentSession({trace,client:{
        snapshot:async()=>session.snapshot(),
        prompt:async text=>{await withSyntheticRuntime(directory,()=>session.prompt(text));return session.snapshot();},
        answer:async(...args)=>{await session.answer(...args);return session.snapshot();},
        cancelQuestion:async(...args)=>{session.cancelQuestion(...args);return session.snapshot();},
        close:()=>session.stop()
      }});
      current.ready=true;
    },
    async stopWriters(run){
      const item=owned(run);item.ready=false;
      await item.client?.drain();
      item.client?.close();await exited(item.session?.child);
      await item.service?.drain();
      await item.broker?.close();item.broker=null;item.stopped=true;
    },
    async archive(run){
      const item=owned(run);
      if(!item.stopped||!item.trace?.healthy())throw Error('Host writers/evidence are not ready for archival');
      // A trusted startup failure can happen before the calendar client or
      // service exists. Preserve the durable state/claim snapshot we do have,
      // without interpreting a missing client as an empty calendar.
      const store=item.store||createStateStore(item.runDirectory);
      try {
        const snapshot=item.service?await item.service.snapshotForArchive():await store.snapshotForArchive(run.student);
        let events=null;try{if(item.calendar)events=await item.calendar.events(run.student);}catch{}
        return await archiveSyntheticRun({directory:path.join(root,'archives'),run,snapshot,observation:events?{availability:'available',events}:{availability:'unavailable',events:null}});
      } finally {if(!item.store)await store.close();}
    },
    async stopSimulator(run){
      owned(run);await retireDockerCalendar({runId:run.id,lease});await retireDockerNetwork({runId:run.id,kind:'calendar',lease});
    },
    async verifyRetired(run){
      const item=owned(run);
      const resources=await Promise.all([inspectDockerCalendar({runId:run.id,lease}),inspectDockerNetwork({runId:run.id,kind:'calendar',lease})]);
      if(!item.stopped||resources.some(r=>r.state!=='absent'))return false;
      await item.store?.close();await disposeSyntheticRuntime(item.runDirectory);current=null;return true;
    },
    async shutdown(){if(current&&!current.stopped)await this.stopWriters({id:current.id,student:current.student});}
  };
}
