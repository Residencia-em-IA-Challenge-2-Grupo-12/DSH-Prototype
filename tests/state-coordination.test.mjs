import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT,readJSON,resetScenario,addFeedback,loadState,draftAnnotation,draft,saveNarrative} from '../src/core.mjs';

class FakeCalendar {
  async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);}
  async events(){return structuredClone(this.items);}
}

test('feedback survives a checkpoint running in another process', {timeout:10000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),'study-state-test-'));
  const ready=join(dir,'ready'), release=join(dir,'release');
  const calendar=new FakeCalendar();await resetScenario(calendar,'ana');
  const program=`import {checkpoint,readJSON,ROOT} from ${JSON.stringify(new URL('../src/core.mjs',import.meta.url).href)};
    import {writeFile,access} from 'node:fs/promises';
    const calendar={events:async()=>{await writeFile(process.argv[1],'ready');while(true){try{await access(process.argv[2]);break;}catch{await new Promise(r=>setTimeout(r,20));}}return (await readJSON(ROOT+'/fixtures/calendars/ana.json')).events;}};
    await checkpoint(calendar,'ana','cross-process check');`;
  const child=spawn(process.execPath,['--input-type=module','-e',program,ready,release],{stdio:['ignore','ignore','ignore']});
  const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('checkpoint process exited '+code)));});
  finished.catch(()=>{});
  try {
    let observed=false;const deadline=Date.now()+5000;
    while(Date.now()<deadline&&!observed){try{observed=(await readFile(ready,'utf8'))==='ready';}catch(error){if(error.code!=='ENOENT')throw error;}if(!observed)await new Promise(resolve=>setTimeout(resolve,20));}
    assert(observed,'checkpoint did not reach its blocked calendar read');
    await addFeedback('ana',{eventId:'synthetic-cross-process',note:'must survive'});
    await writeFile(release,'go');await finished;
    const state=await loadState('ana');
    assert(state.feedback.some(item=>item.eventId==='synthetic-cross-process'),'feedback saved by the other process was lost');
    assert(state.history.some(item=>item.type==='checkpoint'&&item.reason==='cross-process check'),'checkpoint was not saved');
  } finally {child.kill('SIGKILL');await finished.catch(()=>{});await rm(dir,{recursive:true,force:true});}
});

test('legacy synthetic JSON is imported without deleting or overwriting it', async()=>{
  const {createStateStore}=await import('../src/state-store.mjs');
  const dir=await mkdtemp(join(tmpdir(),'study-legacy-test-'));
  const legacy=join(dir,'ana.json');
  const original=JSON.stringify({student:'ana',feedback:[{eventId:'old'}],history:[],plan:null});
  try {
    await writeFile(legacy,original);
    const store=createStateStore(dir);
    assert.equal((await store.load('ana')).feedback[0].eventId,'old');
    await store.update('ana',state=>{state.feedback.push({eventId:'new'});});
    assert.equal(await readFile(legacy,'utf8'),original,'legacy backup changed');
    const reopened=createStateStore(dir);
    assert.deepEqual((await reopened.load('ana')).feedback.map(record=>record.eventId),['old','new']);
  } finally {await rm(dir,{recursive:true,force:true});}
});


test('an annotation draft does not overwrite feedback saved during its calendar read', async()=>{
  const calendar=new FakeCalendar();await resetScenario(calendar,'ana');
  let release,started;
  const entered=new Promise(resolve=>{started=resolve;});
  const original=calendar.events.bind(calendar);
  calendar.events=async()=>{started();await new Promise(resolve=>{release=resolve;});return original();};
  const pending=draftAnnotation(calendar,'ana','ana-class','classes');
  await entered;
  await addFeedback('ana',{eventId:'synthetic-during-annotation',note:'must survive'});
  release();const proposal=await pending;
  const state=await loadState('ana');
  assert(state.feedback.some(item=>item.eventId==='synthetic-during-annotation'),'feedback was overwritten');
  assert.equal(state.pendingAnnotation.id,proposal.id);
});


test('concurrent drafts and feedback retain every feedback record', async()=>{
  const calendar=new FakeCalendar();await resetScenario(calendar,'ana');
  const updates=[];
  for(let index=0;index<8;index++){
    updates.push(draft(calendar,'ana',{weeks:1,hours:1}));
    updates.push(addFeedback('ana',{eventId:'synthetic-draft-'+index}));
  }
  await Promise.all(updates);
  const state=await loadState('ana');
  for(let index=0;index<8;index++)assert(state.feedback.some(item=>item.eventId==='synthetic-draft-'+index),'feedback lost during drafting');
  assert(state.plan,'no proposal was saved');
});
