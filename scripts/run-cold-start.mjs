// Local developer/operator exercise. The same native question messages power
// the companion's widgets. Here they are rendered in a terminal.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeScenario, withSyntheticRuntime, disposeSyntheticRuntime, ROOT } from '../src/core.mjs';
import { StudySession } from '../src/sdk-session.mjs';
import { coldStartStudents } from '../src/cold-start-context.mjs';
import { startCalendarpitRun } from '../src/foundation/calendarpit-runner.mjs';
import { authorizeSyntheticCalendar } from '../src/foundation/synthetic-calendar-auth.mjs';
import { createClaimedCalendar } from '../src/foundation/claimed-calendar.mjs';
import { createTrustedStudyService } from '../src/foundation/trusted-study-service.mjs';
import { startStudyBroker } from '../src/foundation/study-broker.mjs';
import { createExperimentTrace } from '../src/foundation/experiment-trace.mjs';
import { createExperimentSession } from '../src/foundation/experiment-session.mjs';

const [caseId, evidencePath] = process.argv.slice(2);
const dshHome = process.env.STUDY_LUNA_DSH_HOME;
if (!Object.hasOwn(coldStartStudents,caseId) || !evidencePath || !dshHome || !path.isAbsolute(dshHome)) {
  console.error('Set STUDY_LUNA_DSH_HOME to the existing local profile. Usage: run-cold-start.mjs <bruno|bruno-text|ana|ana-conflict> <new evidence directory>');
  process.exit(2);
}
const student = coldStartStudents[caseId];
const evidence = path.resolve(evidencePath);
await mkdir(evidence,{mode:0o700});
const directory = await mkdtemp('/tmp/study-cold-');
const runId = randomUUID();
const trace = await createExperimentTrace({directory:evidence,runId,attemptId:randomUUID()});
const fixture = await readFile(path.join(ROOT,'fixtures/calendars',student+'.json'),'utf8');
const digest = value=>createHash('sha256').update(value).digest('hex');
const result = {caseId,runId,model:'gpt-6-luna',route:'codex',runtime:'host DSH with disposable Calendarpit',usage:'unknown',startedAt:new Date().toISOString()};
let run, broker, service, calendar, session, client, terminal, before;
let replies = [];
let shown = new Set();
const scope = action=>withSyntheticRuntime(directory,action);
const socketPath = path.join(directory,'agent.sock');

async function stopSession() {
  if (!client) return;
  await client.drain();
  const child = session.child;
  const active = child && child.exitCode===null && child.signalCode===null;
  const timer = new AbortController();
  const exit = active ? once(child,'exit',{signal:timer.signal}) : null;
  client.close();
  if (exit) {
    const timeout = setTimeout(()=>timer.abort(),10000);
    try { await exit; } finally {clearTimeout(timeout);}
  }
  client = null;
}

function openSession() {
  shown = new Set();
  session = new StudySession(student,{dshHome:path.normalize(dshHome),brokerSocket:socketPath,coldStart:true});
  client = createExperimentSession({trace,client:{
    snapshot:async()=>session.snapshot(),
    prompt:async text=>{await scope(()=>session.prompt(text));return session.snapshot();},
    answer:async (...args)=>{session.answer(...args);return session.snapshot();},
    cancelQuestion:async id=>{session.cancelQuestion(id);return session.snapshot();},
    close:()=>session.stop(),
  }});
}

async function takeLine(lines,prompt) {
  process.stdout.write(prompt);
  return (await lines.next()).value;
}

async function answerQuestion(lines,request) {
  const answers = [];
  for (const question of request.questions) {
    console.log(question.question || question.header || question.title || question.id);
    const options = question.options || [];
    for (const [index,option] of options.entries()) {
      console.log(`  ${index+1}. ${option.label}${option.description?' · '+option.description:''}`);
    }
    while (true) {
      const response=await takeLine(lines,options.length?'Number(s), typed answer, or :skip > ':'Typed answer or :skip > ');
      if (response===undefined || response.trim()===':skip') {
        await client.cancelQuestion(request.requestId);
        return;
      }
      const text=response.trim();
      if (!text || text.length>2000) continue;
      const indexes=/^[1-9]\d*(?:,\s*[1-9]\d*)*$/.test(text)?text.split(',').map(Number):[];
      const selected=indexes.length&&indexes.every(index=>options[index-1])
        ? [...new Set(indexes)].map(index=>options[index-1].label):[];
      if (selected.length>1 && !question.multiSelect) {
        console.log('Choose one option or type an answer.');
        continue;
      }
      answers.push({id:question.id,selected,custom:selected.length?'':text});
      break;
    }
  }
  await client.answer(request.requestId,answers);
  replies.push(...answers.map(answer=>answer.custom||answer.selected.join(', ')));
}

async function finishTurn(lines) {
  while(true) {
    const view = await client.snapshot();
    for(const message of view.messages) {
      if(message.type==='assistant'&&!shown.has(message.id)){
        console.log('\n'+message.text);
        shown.add(message.id);
      }
    }
    if(view.error)throw new Error(view.error);
    if(view.question)await answerQuestion(lines,view.question);
    else if(!view.busy)break;
    await delay(150);
  }
  const context=await service.agent.call('read_planning_context',{student});
  if(context.pending)console.log('\nReview these planning inputs. Confirm with :confirm '+context.pending.id+'\n'+JSON.stringify(context.pending.record,null,2));
}

try {
  await trace.append('configuration',{...result,fixtureSha256:digest(fixture),simulatedDate:'2026-11-02'});
  const redirectUri='http://127.0.0.1:4175/callback';
  run=await startCalendarpitRun({fixture:JSON.parse(fixture),redirectUri,runId,runDirectory:directory});
  const accessToken=await authorizeSyntheticCalendar({run,student,redirectUri});
  // This research flow reads and drafts only.
  calendar=createClaimedCalendar({origin:run.origin,accessToken,getClaim:async()=>null});
  await scope(()=>initializeScenario(calendar,student,{coldStart:caseId}));
  before=await calendar.events(student);
  service=createTrustedStudyService({student,calendar,runtimeDirectory:directory,trace,coldStart:true});
  broker=await startStudyBroker({socketPath,boundary:service.agent});
  openSession();
  terminal=createInterface({input:process.stdin,terminal:process.stdin.isTTY});
  const lines=terminal[Symbol.asyncIterator]();
  console.log('Fictional exercise. Send a message, :show context and plan, :confirm <revision ID>, :new (new session), or :quit.');
  while(true) {
    const answer=await takeLine(lines,'\nOperator > ');
    if(answer===undefined || answer.trim()===':quit')break;
    const text=answer.trim();
    if(!text)continue;
    if(text===':show'){
      const {courses,state}=await service.status();
      console.log(JSON.stringify({context:courses,plan:state.plan},null,2));
    }else if(text===':new'){
      await stopSession();
      replies=[];
      await trace.append('configuration',{event:'new_session_same_run'});
      openSession();
    }else if(text.startsWith(':confirm ')){
      try {
        const confirmed=await service.confirmPlanningContext(text.slice(9).trim(),replies.slice(-20));
        replies=[];
        console.log('Planning context confirmed '+confirmed.id+'. Send a message to request the draft.');
      } catch(error) {
        console.log(error.message+'. Use :show to inspect the current record.');
      }
    }else{
      replies.push(text.slice(0,2000));
      await client.prompt(text);
      await finishTurn(lines);
    }
  }
  const {courses,state}=await service.status();
  result.context=courses;
  result.plan=state.plan;
  assert.deepEqual(await calendar.events(student),before,'Calendar changed during the review-only exercise');
  result.calendarUnchanged=true;
  result.completed=Boolean(result.plan);
} catch(error) {
  result.failure=error.message;
  process.exitCode=1;
} finally {
  terminal?.close();
  try {
    await stopSession();
    await service?.drain();
    await broker?.close();
    await run?.close();
    await disposeSyntheticRuntime(directory);
    result.retired=true;
  } catch {
    result.retired=false;
    result.cleanup='Run retirement is unverified. Inspect the simulator and network bearing the recorded run ID.';
    process.exitCode=1;
  }
  result.finishedAt=new Date().toISOString();
  await writeFile(path.join(evidence,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({runId,evidence,completed:result.completed??false,retired:result.retired,failure:result.failure,cleanup:result.cleanup}));
}
