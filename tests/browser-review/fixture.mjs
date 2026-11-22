import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
const [repo,student,port,control]=process.argv.slice(2);
const load=file=>import(pathToFileURL(path.join(repo,file)).href);
const {createManagedWeb}=await load('src/foundation/managed-web.mjs');
const {createManagedStudyApi}=await load('src/foundation/managed-study-api.mjs');
const {createTrustedStudyService}=await load('src/foundation/trusted-study-service.mjs');
const {initializeScenario,withSyntheticRuntime,disposeSyntheticRuntime}=await load('src/core.mjs');

const work=await mkdtemp('/tmp/study-scripted-review-');
const original=JSON.parse(await readFile(path.join(repo,'fixtures/calendars',student+'.json'),'utf8')).events;
const created=[];
let initialized=false;
async function command(){
  try{return await readFile(control,'utf8');}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
const edited={id:'new-wednesday-appointment',summary:'New appointment',
  start:{dateTime:'2026-11-04T19:00:00-03:00'},end:{dateTime:'2026-11-04T20:00:00-03:00'}};
const calendar={
  async events(){
    const change=await command();
    return structuredClone([...original,...created,...(initialized&&change==='add'?[edited]:[])]);
  },
  async create(selected,event){
    if(selected!==student||await command()!=='allow-writes'){
      await writeFile(control+'.unexpected','Calendar create called');throw Error('Unexpected write');
    }
    created.push(structuredClone(event));
    return structuredClone(event);
  },
  async remove(){await writeFile(control+'.unexpected','Calendar remove called');throw Error('Unexpected write');}
};

const record=student==='bruno'?{
  courses:[
    {name:'Algoritmos',date:'2026-12-14',time:'09:00',citation:{path:'notices/aviso-turma-n02.md',
      quote:'A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.'}},
    {name:'Banco de Dados',date:'2026-12-14',time:'18:00',citation:{path:'courses/banco-de-dados.md',
      quote:'Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo'}},
  ],
  studyWindows:[{weekday:1,start:'19:00',end:'21:15'},{weekday:3,start:'19:00',end:'21:15'},{weekday:6,start:'14:00',end:'16:15'},{weekday:0,start:'10:00',end:'12:15'}],
  targetHours:5,assumption:'Keep Monday free. The operator needs to check that the normalized windows agree.',
}:{
  courses:[
    {name:'Machine Learning',date:'2026-11-30',time:'12:00',citation:{path:'notices/lms-assessment.txt',
      quote:'Classification project final submission closes at 12:00 on 2026-11-30.'},resolution:'Guide says 18:00. The operator confirmed noon.'},
    {name:'Statistics',date:'2026-12-14',time:'09:00',citation:{path:'courses/applied-statistics.md',
      quote:'The probability and inference exam starts on 2026-12-14 at 09:00, São Paulo time.'}},
  ],
  studyWindows:[{weekday:3,start:'14:00',end:'16:15'},{weekday:5,start:'14:00',end:'16:15'}],
  targetHours:4,assumption:'Use this planning week and retain the conflicting guide as context.',
};
Object.assign(record,{through:student==='bruno'?'2026-11-15':'2026-11-08',maxDailyStudyHours:2,studyBreakMinutes:15});
const caseId=student==='bruno'?'bruno-text':'ana-conflict';
let run=null,service=null,question=null;
const messages=[];
let messageId=0;
function append(type,text){messages.push({id:String(++messageId),type,text});}
const view=()=>({question,messages,busy:false,error:null});
const call=(method,args={})=>service.agent.call(method,{student,...args});
const client={
  snapshot:async()=>view(),
  async prompt(text){
    append('user',text);
    if(text==='Start exercise'){
      if(student==='bruno')await call('preview_study_options',{options:[
        {label:'Tuesday morning',windows:[{date:'2026-11-03',start:'09:00',end:'11:00'}]},
        {label:'Wednesday evening',windows:[{date:'2026-11-04',start:'19:00',end:'20:00'}]},
      ]});
      question={requestId:'first-question',questions:[{id:'choice',question:student==='bruno'?'Which candidate window works?':'Which source should govern?',
        options:(student==='bruno'?['Tuesday morning','Wednesday evening']:['Noon (LMS)','18:00 (module guide)']).map(label=>({label}))}]};
    }else if(text==='Remove Monday'){
      record.studyWindows=record.studyWindows.filter(window=>window.weekday!==1);
      await call('propose_planning_context',{record});
    }else if(text==='Draft the week')await call('draft_study_plan',{weeks:student==='bruno'?2:1});
    else if(student==='ana'&&text==='Show a course coverage alternative')await call('draft_study_plan',{weeks:1,allocation:'course-coverage'});
    return view();
  },
  async answer(id,answers){
    if(question?.requestId!==id)throw Error('Question is no longer pending');
    append('user',answers[0].custom||answers[0].selected.join(', '));
    question=null;
    await call('propose_planning_context',{record});
    return view();
  },
};
const api=createManagedStudyApi({
  manager:{
    async current(){return run;},
    async start(){
      await withSyntheticRuntime(work,()=>initializeScenario(calendar,student,{coldStart:caseId}));
      service=createTrustedStudyService({student,calendar,runtimeDirectory:work,coldStart:true,browserStudy:true});
      run={id:'scripted-'+student,student,phase:'active'};
      initialized=true;
      return run;
    },
  },
  driver:{active:()=>({client,service,student})},
});
const origin=`http://127.0.0.1:${port}`;
const server=createManagedWeb({api:{
  ...api,async runStatus(){return {...await api.runStatus(),runtime:'scripted-review',student,caseId};},
},origin,publicDirectory:path.join(repo,'public')});
server.listen(Number(port),'127.0.0.1',()=>console.log(origin));
process.once('SIGTERM',()=>server.close(()=>disposeSyntheticRuntime(work)));
