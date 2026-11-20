// Bounded synthetic API attempt, not a browser walkthrough or managed Docker
// agent. The trusted host DSH process uses the existing subscription profile.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ROOT,initializeScenario,withSyntheticRuntime} from '../src/core.mjs';
import {StudySession} from '../src/sdk-session.mjs';
import {createStateStore} from '../src/state-store.mjs';
import {startCalendarpitRun} from '../src/foundation/calendarpit-runner.mjs';
import {authorizeSyntheticCalendar} from '../src/foundation/synthetic-calendar-auth.mjs';
import {createClaimedCalendar} from '../src/foundation/claimed-calendar.mjs';
import {createTrustedStudyService} from '../src/foundation/trusted-study-service.mjs';
import {startStudyBroker} from '../src/foundation/study-broker.mjs';
import {createExperimentTrace} from '../src/foundation/experiment-trace.mjs';
import {createExperimentSession} from '../src/foundation/experiment-session.mjs';
import {archiveSyntheticRun} from '../src/foundation/run-archive.mjs';

const dshHome=process.env.STUDY_LUNA_DSH_HOME;
if(!dshHome||!path.isAbsolute(dshHome))throw Error('Set trusted STUDY_LUNA_DSH_HOME; credentials must remain in the existing DSH profile');
const directory=await mkdtemp(path.join(tmpdir(),'study-live-bruno-'));
const run={id:randomUUID(),student:'bruno',createdAt:new Date().toISOString()},attemptId=randomUUID();
const evidenceDirectory=path.join(directory,'experiment');await mkdir(evidenceDirectory,{mode:0o700});
const trace=await createExperimentTrace({directory:evidenceDirectory,runId:run.id,attemptId});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const result={schemaVersion:1,runId:run.id,attemptId,status:'starting',stage:'setup',
  runtime:'host-luna-fallback-api',provider:'codex',model:'gpt-6-luna',harness:'0.2.2-rc.1',
  fixedDate:'2026-11-02',usage:'unknown',limitations:[
    'Prepared persona answers and test-driver near-term approval; not a human browser walkthrough.',
    'Host DSH/controller; only Calendarpit is containerized. This does not establish agent container isolation.',
    'Conversation evidence comes from bounded SDK snapshots; full raw SDK events and provider usage are unavailable.'
  ],preparedAnswers:[],checks:{},cleanup:{writersStopped:false,evidenceArchived:false,simulatorRetired:false}};
let simulator,calendar,service,broker,session,client,before;
const inRun=operation=>withSyntheticRuntime(directory,operation);
const save=()=>writeFile(path.join(directory,'attempt.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
async function settled(){
  let questions=0;
  while(true){
    const view=await client.snapshot();
    if(view.error)throw Error('Luna turn reported failure');
    if(view.question){
      if(++questions>2)throw Error('Prepared persona question budget exceeded');
      const custom='Prepared fictional exercise answer: the stated five-hour target and existing study windows still suit this exercise. Keep existing commitments fixed. Relative course difficulty, mastery, remaining effort and other personal facts are unspecified; keep those unknown and explain any provisional allocation. You may prepare later tentative blocks for review, without approval. Please proceed with a provisional plan using only supported inputs.';
      const answers=view.question.questions.map(q=>({id:q.id,selected:[],custom}));
      result.preparedAnswers.push({requestId:view.question.requestId,answers});
      await client.answer(view.question.requestId,answers);console.log('Answered a native question with the prepared fictional persona.');
    }else if(!view.busy)return view;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
}
try{
  const fixtureText=await readFile(path.join(ROOT,'fixtures/calendars/bruno.json'),'utf8');
  await trace.append('configuration',{runtime:result.runtime,provider:result.provider,model:result.model,harness:result.harness,
    fixedDate:result.fixedDate,fixtureSha256:createHash('sha256').update(fixtureText).digest('hex'),usage:'unknown'});
  await save();console.log('Synthetic Luna attempt evidence: '+directory);
  simulator=await startCalendarpitRun({fixture:JSON.parse(fixtureText),redirectUri:'http://127.0.0.1:4175/callback',runId:run.id,runDirectory:directory});
  const accessToken=await authorizeSyntheticCalendar({run:simulator,student:'bruno',redirectUri:'http://127.0.0.1:4175/callback'});
  const store=createStateStore(directory);
  calendar=createClaimedCalendar({origin:simulator.origin,accessToken,getClaim:()=>store.getCalendarClaim()});
  await inRun(()=>initializeScenario(calendar,'bruno'));
  service=createTrustedStudyService({student:'bruno',calendar,runtimeDirectory:directory,trace});
  const ipc=path.join(directory,'ipc');await mkdir(ipc,{mode:0o700});
  broker=await startStudyBroker({socketPath:path.join(ipc,'agent.sock'),boundary:service.agent});
  session=new StudySession('bruno',{dshHome,brokerSocket:path.join(ipc,'agent.sock')});
  client=createExperimentSession({trace,client:{
    snapshot:async()=>session.snapshot(),
    prompt:async text=>{await inRun(()=>session.prompt(text));return session.snapshot();},
    answer:async(...args)=>{session.answer(...args);return session.snapshot();},
    cancelQuestion:async(...args)=>{session.cancelQuestion(...args);return session.snapshot();},close:()=>session.stop()
  }});
  before=await calendar.events('bruno');
  result.stage='initial-plan';await save();
  await client.prompt('Help Bruno prepare for the deadlines on 14 December 2026. Read the selected materials and calendar, explain assumptions and compromises, and ask a consequential missing question before proposing. Use the authored five-hour weekly target unless the discussion changes it. Provide a detailed coming week and a six-week outlook; prepare future tentative blocks only for separate review. Do not approve calendar changes.');
  await settled();
  let state=(await service.status()).state;
  assert(state.plan?.near?.length,'No reviewable initial proposal');
  result.initialPlan=state.plan;result.checks.noWriteBeforeApproval=digest(await calendar.events('bruno'))===digest(before);
  assert(result.checks.noWriteBeforeApproval);
  result.stage='monday-correction';await save();
  await client.prompt('Keep Monday, 2 November 2026 free of new study blocks. Preserve existing commitments, revise the proposal using avoidDates, and explain what moved or no longer fits. Do not apply anything.');
  await settled();state=(await service.status()).state;
  const plan=state.plan;assert.equal(plan.outlook.length,6,'Expected six-week outlook');assert.notEqual(plan.id,result.initialPlan.id,'Correction did not create a proposal revision');
  assert(plan.near.length>0);assert(plan.near.every(event=>!event.start.dateTime.startsWith('2026-11-02')));
  assert.equal(digest(await calendar.events('bruno')),digest(before));
  result.revisedPlan=plan;result.checks.mondayStudyAdditions=0;result.checks.noWriteBeforeApproval=true;
  const time=(event,key)=>Date.parse(event[key].dateTime||event[key].date);
  for(const block of plan.near)for(const event of before.filter(e=>e.status!=='cancelled'&&e.transparency!=='transparent'))
    assert(!(time(block,'start')<time(event,'end')&&time(event,'start')<time(block,'end')),'Study block conflicts with a fixed event');
  result.checks.conflictFree=true;result.checks.questionObserved=result.preparedAnswers.length>0;
  result.stage='near-approval';await save();
  await service.approvePlan(plan.id,'near');
  const observed=await service.status();
  assert.equal(observed.calendar.availability,'available');assert.equal(observed.state.plan.status.near,'applied');
  assert.equal(observed.state.plan.status.future,'pending');
  for(const event of plan.near)assert(observed.events.some(actual=>actual.id===event.id));
  for(const event of plan.future)assert(!observed.events.some(actual=>actual.id===event.id));
  for(const event of before)assert.equal(digest(observed.events.find(actual=>actual.id===event.id)),digest(event));
  result.checks={...result.checks,nearEventsObserved:plan.near.length,futureEventsObserved:0,existingEventsPreserved:true,futureApproval:'pending'};
  result.finalState=observed;result.conversation=await client.snapshot();result.status='completed';
}catch(error){
  result.status='failed';result.failure={stage:result.stage,reason:error?.code==='ERR_ASSERTION'?'Acceptance assertion failed':'Setup or turn failed; inspect retained synthetic state'};
  await trace.append('failure',result.failure).catch(()=>{});process.exitCode=1;
}finally{
  result.finishedAt=new Date().toISOString();result.durationMs=Date.parse(result.finishedAt)-Date.parse(run.createdAt);
  try{
    if(client){await client.snapshot();await client.drain();client.close();}
    if(session?.child&&session.child.exitCode===null&&session.child.signalCode===null){
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Host writer stop unverified')),15000);session.child.once('exit',()=>{clearTimeout(timer);resolve();});});
    }
    result.cleanup.writersStopped=true;
    if(service){
      await service.drain();const snapshot=await service.snapshotForArchive();
      let events=null;try{events=await calendar.events('bruno');}catch{}
      result.recoveryArchive=await archiveSyntheticRun({directory:path.join(directory,'recovery-archive'),run,snapshot,
        observation:{availability:events?'available':'unavailable',events}});
      result.cleanup.evidenceArchived=trace.healthy();
    }else result.cleanup.evidenceArchived=trace.healthy();
    await save();
    if(result.cleanup.evidenceArchived){await broker?.close();await simulator?.close();result.cleanup.simulatorRetired=true;}
  }catch{result.cleanup.blocked=true;process.exitCode=1;}
  await save();console.log(JSON.stringify({status:result.status,stage:result.stage,checks:result.checks,cleanup:result.cleanup,evidenceDirectory:directory}));
}
