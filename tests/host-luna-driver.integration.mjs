import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createHostLunaDriver} from '../src/foundation/host-luna-driver.mjs';
import {createExclusiveRunManager} from '../src/foundation/exclusive-run-manager.mjs';
import {createManagedStudyApi} from '../src/foundation/managed-study-api.mjs';
import {startControllerRpc,createControllerClient} from '../src/foundation/controller-rpc.mjs';
import {createManagedHttpHandler} from '../src/foundation/managed-http.mjs';
import {createStudyBrokerClient} from '../src/foundation/study-broker.mjs';
import {authorizeSyntheticCalendar} from '../src/foundation/synthetic-calendar-auth.mjs';
import {inspectDockerCalendar,inspectDockerNetwork} from '../src/foundation/docker-retirement.mjs';

// Authored responses exercise plumbing only. No subscription profile or model
// is opened; actual Calendarpit, broker, state, approval and HTTP are exercised.
class ScriptedSession{
  constructor({brokerSocket}){this.broker=createStudyBrokerClient({socketPath:brokerSocket});this.messages=[];this.question=null;this.busy=false;this.child=null;this.closed=false;}
  snapshot(){return {student:'bruno',messages:this.messages,question:this.question,busy:this.busy,error:null};}
  async prompt(text){
    assert(!this.closed);this.messages.push({id:randomUUID(),type:'user',text});
    if(text==='initial'){
      await this.broker.call('read_synthetic_file',{student:'bruno',path:'context/preferencias.md'});
      await this.broker.call('list_calendar',{student:'bruno'});
      this.question={requestId:'prepared-hours',questions:[{id:'hours',question:'Use the authored five-hour target?'}]};this.busy=true;
    }else await this.draft(['2026-11-02']);
  }
  async draft(avoidDates=[]){
    await this.broker.call('draft_study_plan',{student:'bruno',weeks:6,hours:5,avoidDates});
    this.messages.push({id:randomUUID(),type:'assistant',text:'SCRIPTED infrastructure response; proposal ready.'});this.busy=false;
  }
  async answer(requestId){assert.equal(requestId,this.question.requestId);this.question=null;await this.draft();}
  cancelQuestion(){this.question=null;this.busy=false;}
  stop(){this.closed=true;}
}

test('host fallback: real simulator and HTTP support question, correction, near-only approval and verified retirement',
  {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:90000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'study-host-ui-'));let manager,driver,rpc,web,run;
  const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  try{
    manager=await createExclusiveRunManager({root,driverFactory:({lease})=>{
      driver=createHostLunaDriver({root,lease,dshHome:'/unused/synthetic-profile',sessionFactory:o=>new ScriptedSession(o)});return driver;
    }});
    rpc=await startControllerRpc({socketPath:path.join(root,'controller.sock'),api:createManagedStudyApi({manager,driver})});
    let handler;web=http.createServer((req,res)=>handler(req,res));
    await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${web.address().port}`;
    handler=createManagedHttpHandler({origin,api:createControllerClient({socketPath:path.join(root,'controller.sock')})});
    const get=async name=>(await fetch(`${origin}/api/${name}?runId=${run.id}`)).json();
    const post=async(name,data={})=>{
      const res=await fetch(`${origin}/api/${name}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({runId:run?.id,...data})});
      return {status:res.status,body:await res.json()};
    };
    run=(await post('run/start',{student:'bruno'})).body;assert.equal(run.phase,'active');
    const before=(await get('status')).events;
    assert.equal((await post('approve',{runId:'stale',planId:'p',section:'near'})).status,400);
    assert.equal((await post('chat/send',{text:'initial'})).status,200);
    assert((await get('chat/state')).question);
    await post('chat/answer',{requestId:'prepared-hours',answers:[{id:'hours',selected:[],custom:'Five hours'}]});
    const initial=(await get('status')).state.plan;assert(initial.near.length);
    assert.equal(digest((await get('status')).events),digest(before),'unapproved proposal must not write');
    await post('chat/send',{text:'Monday correction'});
    const revised=(await get('status')).state.plan;assert.notEqual(revised.id,initial.id);
    assert(revised.near.every(e=>!e.start.dateTime.startsWith('2026-11-02')));
    assert.equal((await post('approve',{planId:initial.id,section:'near'})).status,400);
    assert.equal(digest((await get('status')).events),digest(before),'stale approval must not write');
    assert.equal((await post('approve',{planId:revised.id,section:'near'})).status,200);
    const after=await get('status');assert.equal(after.state.plan.status.near,'applied');assert.equal(after.state.plan.status.future,'pending');
    for(const event of before)assert.equal(digest(after.events.find(e=>e.id===event.id)),digest(event));
    for(const event of revised.future)assert(!after.events.some(e=>e.id===event.id));
    assert.equal((await post('run/retire')).status,200);assert.equal(await manager.current(),null);
    const archive=JSON.parse(await readFile(path.join(root,'archives',run.id+'.json'),'utf8'));
    assert.equal(archive.observation.availability,'available');assert.equal(archive.snapshot.state.plan.status.future,'pending');
    assert.equal(driver.active(run.id),null);assert.equal((await post('chat/send',{text:'old run'})).status,400);
  }finally{
    if(web)await new Promise(resolve=>web.close(resolve));await rpc?.close();
    const remaining=await manager?.current();
    if(remaining)await manager.retire({expectedRunId:remaining.id});
    await manager?.close();await rm(root,{recursive:true,force:true});
  }
});

test('host fallback archives a known pre-service startup failure before verified retirement',
  {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:90000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'study-host-startup-failure-'));
  let manager,driver,lease,runId,attempts=0;
  const sessionFactory=()=>({child:null,snapshot:()=>({student:'bruno',messages:[],question:null,busy:false,error:null}),
    prompt:async()=>{},answer:async()=>{},cancelQuestion:async()=>{},stop(){}});
  try{
    manager=await createExclusiveRunManager({root,driverFactory:context=>{
      lease=context.lease;
      driver=createHostLunaDriver({root,lease,dshHome:'/unused/synthetic-profile',sessionFactory,
        authorizeCalendar:async options=>{
          attempts++;
          runId=options.run.id;
          if(attempts===1)throw Error('synthetic authorization startup failure');
          return authorizeSyntheticCalendar(options);
        }});
      return driver;
    }});
    await assert.rejects(manager.start('bruno'),/startup failed/i);
    assert.equal((await manager.current()).phase,'start-failed');
    assert.equal((await inspectDockerCalendar({runId,lease})).state,'running','Calendarpit should exist before recovery');
    await manager.retire({expectedRunId:runId});
    const archive=JSON.parse(await readFile(path.join(root,'archives',`${runId}.json`),'utf8'));
    assert.equal(archive.snapshot.state,null,'no initialized state should be invented');
    assert.equal(archive.snapshot.claim,null);
    assert.deepEqual(archive.snapshot.claimHistory,[]);
    assert.equal(archive.observation.availability,'unavailable','a missing client is not an empty-calendar observation');
    assert.equal(archive.observation.events,null);
    assert.equal((await inspectDockerCalendar({runId,lease})).state,'absent');
    assert.equal((await inspectDockerNetwork({runId,kind:'calendar',lease})).state,'absent');
    assert.equal(await manager.current(),null,'the failed run should release its slot after archive and verified retirement');

    const previousId=runId,next=await manager.start('bruno');
    assert.notEqual(next.id,previousId,'a new run should start only after the failed run is retired');
    await manager.retire({expectedRunId:next.id});
  }finally{
    const remaining=await manager?.current().catch(()=>null);
    if(remaining)await manager.retire({expectedRunId:remaining.id});
    await manager?.close();await rm(root,{recursive:true,force:true});
  }
});
