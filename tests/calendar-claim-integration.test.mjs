import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT,readJSON,resetScenario,draft,applyApproved,addFeedback,loadState,getRecoveryClaim,runtimeDir} from '../src/core.mjs';

test('an in-flight approved write has a durable claim and blocks drafts and simulator reset',async()=>{
  let release,started;
  const entered=new Promise(resolve=>{started=resolve;});
  const calendar={
    resets:0,
    async reset(student){this.resets++;this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);},
    async create(_student,event){this.items.push(structuredClone(event));started();await new Promise(resolve=>{release=resolve;});return event;},
    async remove(_student,id){this.items=this.items.filter(event=>event.id!==id);}
  };
  await resetScenario(calendar,'ana');
  const plan=await draft(calendar,'ana',{weeks:1,hours:1});
  const applying=applyApproved(calendar,'ana',plan.id,'near');
  await entered;
  try {
    const claim=await getRecoveryClaim();
    assert.equal(claim.proposalId,plan.id);
    assert.equal(claim.section,'near');
    assert.equal(claim.decision.kind,'approved');assert.equal(claim.decision.section,'near');
    assert(claim.steps.some(step=>step.status==='sent'&&step.actionId===`create:${plan.near[0].id}`));
    const file=join(runtimeDir(),'claim-from-child.json');
    const code=`import {getRecoveryClaim} from ${JSON.stringify(new URL('../src/core.mjs',import.meta.url).href)};import {writeFile} from 'node:fs/promises';await writeFile(process.argv[1],JSON.stringify(await getRecoveryClaim()));`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',code,file],{env:process.env,encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);
    assert.equal(JSON.parse(await readFile(file,'utf8')).id,claim.id);
    const contender=join(runtimeDir(),'contender.json');
    const contenderCode=`import {resetScenario} from ${JSON.stringify(new URL('../src/core.mjs',import.meta.url).href)};import {writeFile} from 'node:fs/promises';
      let called=false,error='';try{await resetScenario({reset:async()=>{called=true;}},'bruno');}catch(e){error=e.message;}await writeFile(process.argv[1],JSON.stringify({called,error}));`;
    const competing=spawnSync(process.execPath,['--input-type=module','-e',contenderCode,contender],{env:process.env,encoding:'utf8'});
    assert.equal(competing.status,0,competing.stderr);
    const result=JSON.parse(await readFile(contender,'utf8'));
    assert.equal(result.called,false);assert.match(result.error,/unresolved/i);
    await assert.rejects(()=>draft(calendar,'ana',{weeks:1,hours:1}),/unresolved/i);
    await assert.rejects(()=>resetScenario(calendar,'bruno'),/unresolved/i);
    assert.equal(calendar.resets,1);
    await addFeedback('ana',{eventId:'during-claimed-write'});
  } finally {release();}
  await applying;
  assert.equal(await getRecoveryClaim(),null);
  assert((await loadState('ana')).feedback.some(record=>record.eventId==='during-claimed-write'));
});

test('an interrupted writer leaves its sent action claimed across restart', {timeout:10000}, async()=>{
  const ready=join(runtimeDir(),'write-started.json');
  const code=`import {ROOT,readJSON,resetScenario,draft,applyApproved} from ${JSON.stringify(new URL('../src/core.mjs',import.meta.url).href)};
    import {writeFile} from 'node:fs/promises';
    const calendar={async reset(s){this.items=structuredClone((await readJSON(ROOT+'/fixtures/calendars/'+s+'.json')).events);},
      async events(){return structuredClone(this.items);},async create(_s,e){await writeFile(process.argv[1],JSON.stringify(e));await new Promise(()=>setInterval(()=>{},1000));},async remove(){}};
    await resetScenario(calendar,'ana');const plan=await draft(calendar,'ana',{weeks:1,hours:1});await applyApproved(calendar,'ana',plan.id,'near');`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,ready],{env:process.env,stdio:'ignore'});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  try {
    let exists=false;const deadline=Date.now()+5000;
    while(Date.now()<deadline&&!exists){try{await access(ready);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}if(!exists)await new Promise(resolve=>setTimeout(resolve,20));}
    assert(exists,'writer did not start the synthetic provider call');
    child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');
    const event=JSON.parse(await readFile(ready,'utf8'));
    const claim=await getRecoveryClaim();
    assert.equal(claim.kind,'approval');
    assert(claim.steps.some(step=>step.actionId===`create:${event.id}`&&step.status==='sent'));
    assert.equal((await loadState('ana')).plan.status.near,'applying');
    let resetCalled=false;
    await assert.rejects(()=>resetScenario({reset:async()=>{resetCalled=true;}},'bruno'),/unresolved/i);
    assert.equal(resetCalled,false);
  } finally {child.kill('SIGKILL');await exited.catch(()=>{});}
});

test('a reset response does not complete a claim if the loaded fixture is not observed',async()=>{
  const calendar={async reset(){},async events(){return [];}};
  await assert.rejects(()=>resetScenario(calendar,'ana'),/RESET UNRESOLVED/);
  const claim=await getRecoveryClaim();
  assert.equal(claim.kind,'reset');
  assert(claim.steps.some(step=>step.status==='sent'));
  assert(!claim.steps.some(step=>step.status==='confirmed'));
  await assert.rejects(()=>resetScenario(calendar,'bruno'),/unresolved/i);
});

test('feedback cannot be erased by a reset already in progress',async()=>{
  let release,started,hold=false;
  const entered=new Promise(resolve=>{started=resolve;});
  const calendar={
    async reset(student){if(hold){started();await new Promise(resolve=>{release=resolve;});}this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);}
  };
  await resetScenario(calendar,'ana');hold=true;
  const resetting=resetScenario(calendar,'ana');await entered;
  try {await assert.rejects(()=>addFeedback('ana',{eventId:'during-reset'}),/reset is unresolved/i);}
  finally {release();}
  await resetting;
  assert.equal(await getRecoveryClaim(),null);
});

test('a claim persistence failure prevents the provider write', {timeout:15000}, async()=>{
  const calendar={writes:0,
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);},
    async create(_student,event){this.writes++;this.items.push(event);return event;},
    async remove(){this.writes++;}
  };
  await resetScenario(calendar,'ana');
  const plan=await draft(calendar,'ana',{weeks:1,hours:1});
  const ready=join(runtimeDir(),'db-locked');
  const code=`import {DatabaseSync} from 'node:sqlite';import {writeFile} from 'node:fs/promises';
    const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');await writeFile(process.argv[2],'locked');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,join(runtimeDir(),'state.sqlite'),ready],{stdio:'ignore'});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>resolve());});
  try {
    let exists=false;const deadline=Date.now()+5000;
    while(Date.now()<deadline&&!exists){try{await access(ready);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}if(!exists)await new Promise(resolve=>setTimeout(resolve,20));}
    assert(exists,'test process did not acquire the SQLite lock');
    await assert.rejects(()=>applyApproved(calendar,'ana',plan.id,'near'),/locked|busy/i);
    assert.equal(calendar.writes,0);
  } finally {child.kill('SIGKILL');await exited.catch(()=>{});}
  assert.equal(await getRecoveryClaim(),null);
  assert.equal((await loadState('ana')).plan.status.near,'pending');
});
