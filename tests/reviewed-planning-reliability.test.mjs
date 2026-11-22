import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {registerStudyTools} from '../src/mcp-tools.mjs';
import {applyApproved,initializeScenario,ROOT,runtimeDir,makePlan} from '../src/core.mjs';
import {createTrustedStudyService} from '../src/foundation/trusted-study-service.mjs';
import {courseMinutes} from '../public/planning-review.js';

async function exercise(student,caseId,record) {
  const fixture=JSON.parse(await readFile(path.join(ROOT,'fixtures/calendars',student+'.json'),'utf8'));
  const calendar={events:async()=>structuredClone(fixture.events)};
  await initializeScenario(calendar,student,{coldStart:caseId});
  const service=createTrustedStudyService({student,calendar,runtimeDirectory:runtimeDir(),coldStart:true,browserStudy:true});
  const call=(method,args={})=>service.agent.call(method,{student,...args});
  const pending=await call('propose_planning_context',{record});
  const confirmed=await service.confirmPlanningContext(pending.id,['Use only the reviewed windows and workload.']);
  return {calendar,call,confirmed,baseline:fixture.events};
}

const scope={through:'2026-11-15',targetHours:5,maxDailyStudyHours:2,studyBreakMinutes:15,
  assumption:'Two weeks only. No Monday and no stated course priority.'};
const bruno={
  ...scope,
  courses:[
    {name:'Algoritmos',date:'2026-12-14',time:'09:00',citation:{path:'notices/aviso-turma-n02.md',
      quote:'A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.'}},
    {name:'Banco de Dados',date:'2026-12-14',time:'18:00',citation:{path:'courses/banco-de-dados.md',
      quote:'Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo'}},
  ],
  studyWindows:[{weekday:3,start:'19:00',end:'21:15'},
    {weekday:6,start:'14:00',end:'16:15'},{weekday:0,start:'10:00',end:'12:15'}],
};
const ana={
  ...scope,through:'2026-11-08',targetHours:4,assumption:'Four hours this week with no stated course priority.',
  courses:[
    {name:'Machine Learning',date:'2026-11-30',time:'12:00',citation:{path:'notices/lms-assessment.txt',
      quote:'Classification project final submission closes at 12:00 on 2026-11-30.'},resolution:'Operator confirmed noon.'},
    {name:'Statistics',date:'2026-12-14',time:'09:00',citation:{path:'courses/applied-statistics.md',
      quote:'The probability and inference exam starts on 2026-12-14 at 09:00, São Paulo time.'}},
  ],
  studyWindows:[{weekday:3,start:'14:00',end:'16:15'},{weekday:5,start:'14:00',end:'16:15'}],
};

test('a browser cold-start draft exposes weeks and gets every weekly target from the confirmed revision',async t=>{
  const schemas=coldStart=>{
    const records=new Map();
    registerStudyTools({registerTool:(name,value)=>records.set(name,value.inputSchema)},()=>{}, {coldStart});
    return records;
  };
  assert.equal(Object.hasOwn(schemas(true).get('draft_study_plan'),'hours'),false);
  assert.equal(Object.hasOwn(schemas(false).get('draft_study_plan'),'hours'),true);
  const {call,confirmed}=await exercise('bruno','bruno-text',bruno);
  await assert.rejects(()=>call('draft_study_plan',{weeks:2,hours:10}),/change the confirmed hours/);
  const proposal=await call('draft_study_plan',{weeks:2});
  assert.equal(proposal.planningContextRevisionId,confirmed.id);
  assert.deepEqual(proposal.outlook.map(week=>week.targetHours),[5,5]);
  assert.equal(proposal.near.length,5);
  assert.ok(proposal.future.length>0);
  assert.ok([...proposal.near,...proposal.future].every(block=>!['2026-11-02','2026-11-09'].includes(block.start.dateTime.slice(0,10))));
  t.diagnostic(JSON.stringify({weeklyTargets:proposal.outlook.map(week=>week.targetHours),near:proposal.near.length,future:proposal.future.length}));
});

test('the agent receives actual conflicts before asking about adjacent and overlapping options',async()=>{
  const {call}=await exercise('bruno','bruno-text',bruno);
  const result=await call('preview_study_options',{options:[
    {label:'Starts after commute',windows:[{date:'2026-11-04',start:'19:00',end:'20:00'}]},
    {label:'Starts during commute',windows:[{date:'2026-11-04',start:'18:45',end:'19:45'}]},
    {label:'Tuesday at work',windows:[{date:'2026-11-03',start:'09:00',end:'10:00'}]},
  ]});
  assert.deepEqual(result.options[0].windows[0].conflicts,[]);
  assert.deepEqual(result.options[1].windows[0].conflicts.map(x=>x.summary),['Deslocamento']);
  assert.deepEqual(result.options[2].windows[0].conflicts.map(x=>x.summary),['Trabalho']);
});

test('Ana has a feasible coverage alternative at the cost of one Machine Learning block',async t=>{
  const {call,calendar,baseline}=await exercise('ana','ana-conflict',ana);
  const current=await call('draft_study_plan',{weeks:1});
  const alternative=await call('draft_study_plan',{weeks:1,allocation:'course-coverage'});
  assert.equal(alternative.baseHash,current.baseHash);
  assert.equal(alternative.planningContextRevisionId,current.planningContextRevisionId);
  assert.deepEqual(alternative.near.map(e=>e.start),current.near.map(e=>e.start));
  assert.deepEqual(alternative.near.map(e=>e.end),current.near.map(e=>e.end));
  const before=courseMinutes(current.sources,current.near),after=courseMinutes(alternative.sources,alternative.near);
  assert.deepEqual(before,[['Machine Learning',240],['Statistics',0]]);
  assert.deepEqual(after,[['Machine Learning',180],['Statistics',60]]);
  assert.equal(alternative.allocation,'course-coverage');
  await assert.rejects(()=>call('draft_study_plan',{weeks:1,allocation:'course-coverage',focusCourse:'Statistics'}),/single-course focus/);
  await assert.rejects(()=>applyApproved(calendar,'ana',current.id,'near'),/not pending/);
  assert.deepEqual(await calendar.events(),baseline);
  t.diagnostic(JSON.stringify({before,after,timeWindowsIdentical:true,calendarWrites:0}));
});

test('coverage skips expired courses and leaves the earliest eligible course first when only one block can fit',()=>{
  const profile={student:'ana',timezone:'America/Sao_Paulo',targetHours:1,studyWindows:[{weekday:3,start:'14:00',end:'15:00'}],
    courses:[{name:'Expired',deadline:'2026-11-03T10:00:00-03:00',source:'old.md'},
      {name:'Near',deadline:'2026-11-06T10:00:00-03:00',source:'near.md'},
      {name:'Later',deadline:'2026-11-23T10:00:00-03:00',source:'later.md'}]};
  const result=makePlan(profile,[],{weeks:1,allocation:'course-coverage'});
  assert.deepEqual(result.near.map(event=>event.extendedProperties.private.course),['Near']);
});
