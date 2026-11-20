import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {initializeScenario,listWorkspace,readWorkspace,applyApproved,ROOT,runtimeDir} from '../src/core.mjs';
import {createTrustedStudyService} from '../src/foundation/trusted-study-service.mjs';

const brunoRecord={
  courses:[
    {name:'Algoritmos',date:'2026-12-14',time:'09:00',citation:{path:'notices/aviso-turma-n02.md',
      quote:'A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.'}},
    {name:'Banco de Dados',date:'2026-12-14',time:'18:00',citation:{path:'courses/banco-de-dados.md',
      quote:'Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo'}},
  ],
  studyWindows:[{weekday:3,start:'19:00',end:'21:15'},{weekday:6,start:'14:00',end:'16:15'},{weekday:0,start:'10:00',end:'12:15'}],
  targetHours:5,maxDailyStudyHours:2,studyBreakMinutes:15,through:'2026-11-08',
  assumption:'Priority between courses unknown. Wednesday is available this week only.',
};

async function exercise(student,caseId) {
  const fixture=JSON.parse(await readFile(`${ROOT}/fixtures/calendars/${student}.json`,'utf8'));
  const events=()=>Promise.resolve(structuredClone(fixture.events));
  const calendar={events};
  await initializeScenario(calendar,student,{coldStart:caseId});
  const open=()=>createTrustedStudyService({student,calendar,runtimeDirectory:runtimeDir(),coldStart:true});
  return {open,calendar,original:fixture.events};
}

test('cold-start planner uses confirmed cited facts and retains an operator answer across sessions',async()=>{
  const {open,calendar,original}=await exercise('bruno','bruno');
  const first=open();
  const call=(service,method,args={})=>service.agent.call(method,{...args,student:'bruno'});
  assert.deepEqual((await listWorkspace('bruno')).map(x=>x.name).sort(),['courses','notices']);
  const packet=await readWorkspace('bruno','courses/algoritmos.pdf');
  assert.match(packet.split('\f')[1],/07\/12\/2026/);
  assert.match(await readWorkspace('bruno','notices/aviso-turma-n02.md'),/14\/12\/2026 às 09:00/);
  assert.deepEqual(await call(first,'read_planning_context'),{caseId:'bruno',pending:null,confirmed:null});
  await assert.rejects(()=>call(first,'draft_study_plan'),/Review the planning context/);
  const invalid=structuredClone(brunoRecord);
  invalid.courses[0].citation.quote='The exam happens on Mars';
  await assert.rejects(()=>call(first,'propose_planning_context',{record:invalid}),/Cited quote/);
  const pending=await call(first,'propose_planning_context',{record:brunoRecord});
  await assert.rejects(()=>call(first,'confirm_planning_context',{id:pending.id}),/operation is not available/);
  await assert.rejects(()=>call(first,'draft_study_plan'),/pending planning context/);
  await assert.rejects(()=>first.confirmPlanningContext('old-revision',['Yes']),/changed/);
  const replies=['Quarta à noite funciona só nesta semana. Quero cinco horas, máximo duas por dia e intervalo de 15 minutos.'];
  await first.confirmPlanningContext(pending.id,replies);
  await first.drain();
  const reopened=open();
  const context=await call(reopened,'read_planning_context');
  assert.deepEqual(context.confirmed.operatorReplies,replies);
  assert.equal(context.confirmed.id,pending.id);
  const plan=await call(reopened,'draft_study_plan',{hours:19,weeks:3});
  assert.equal(plan.planningContextRevisionId,pending.id);
  assert.equal(plan.near.length,5);
  assert.equal(plan.future.length,0);
  assert.equal(plan.outlook.length,1);
  assert.equal(plan.sources[0].deadline,'2026-12-14T09:00:00-03:00');
  assert.equal(plan.sources[0].evidence.path,'notices/aviso-turma-n02.md');
  const revision=await call(reopened,'propose_planning_context',{record:{...brunoRecord,targetHours:4}});
  await assert.rejects(()=>applyApproved(calendar,'bruno',plan.id,'near'),/STALE/);
  await reopened.confirmPlanningContext(revision.id,['Quatro horas são suficientes.']);
  assert.equal((await reopened.status()).state.plan,null);
  await assert.rejects(()=>applyApproved(calendar,'bruno',plan.id,'near'),/not pending/);
  assert.deepEqual(await calendar.events(),original);
});

test('Ana conflict offers no hidden answer and the planner waits for operator resolution',async()=>{
  const {open}=await exercise('ana','ana-conflict');
  const service=open();
  const call=(method,args={})=>service.agent.call(method,{student:'ana',...args});
  const guide=await call('read_synthetic_file',{path:'courses/module-guide.md'});
  const tile=await call('read_synthetic_file',{path:'notices/lms-assessment.txt'});
  assert.match(guide,/Final submission closes.*2026-11-30 18:00/);
  assert.match(tile,/12:00 on 2026-11-30/);
  await assert.rejects(()=>call('read_synthetic_file',{path:'courses.json'}),/ENOENT/);
  await assert.rejects(()=>call('draft_study_plan'),/Review the planning context/);
  const reviewed={
    ...brunoRecord,
    courses:[{name:'Machine Learning Foundations',date:'2026-11-30',time:'12:00',
      citation:{path:'notices/lms-assessment.txt',quote:'Classification project final submission closes at 12:00 on 2026-11-30.'},
      resolution:'Operator verified the noon LMS deadline with the instructor.'}],
    studyWindows:[{weekday:6,start:'10:00',end:'12:15'}],targetHours:2,
  };
  const proposed=await call('propose_planning_context',{record:reviewed});
  await service.confirmPlanningContext(proposed.id,['The instructor confirmed noon. Saturday 10 to noon works this week.']);
  const plan=await call('draft_study_plan',{weeks:1});
  assert.equal(plan.sources[0].deadline,'2026-11-30T12:00:00-03:00');
  assert.match(plan.sources[0].resolution,/Operator verified/);
});
