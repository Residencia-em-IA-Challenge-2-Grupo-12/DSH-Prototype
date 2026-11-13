import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {ROOT} from '../src/core.mjs';
import {startStudyBroker} from '../src/foundation/study-broker.mjs';

test('the actual subscription plugin is restricted to the eight study tools without a model call',{timeout:20000},async()=>{
  const entry=process.env.STUDY_SUBSCRIPTIONS_ENTRY;
  assert(entry&&isAbsolute(entry),'Set STUDY_SUBSCRIPTIONS_ENTRY to the installed plugin public entrypoint');
  const directory=await mkdtemp(join(tmpdir(),'study-subcatalog-'));
  const file=join(directory,'catalog.json'),socketPath=join(directory,'agent.sock'),patch=join(directory,'audit.patch.yml');
  const broker=await startStudyBroker({socketPath,boundary:{call(){throw Error('Catalog probe does not perform calendar operations');}}});
  await writeFile(patch,`- insert:\n    - id: llm-subscriptions\n      name: ${JSON.stringify(entry)}\n      config:\n        providers: [codex]\n        pool:\n          enabled: false\n    - id: study-subscription-catalog-audit\n      name: ${JSON.stringify(join(ROOT,'tests/fixtures/dsh-subscription-catalog-audit.mjs'))}\n`);
  const child=spawn(process.execPath,[join(ROOT,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','sdk',
    '--patch',join(ROOT,'dsh-study.patch.yml'),'--patch',join(ROOT,'dsh-broker.patch.yml'),'--patch',patch],{
    cwd:ROOT,env:{PATH:process.env.PATH,DSH_HOME:join(directory,'empty-dsh-home'),STUDY_TOOL_AUDIT_FILE:file,
      STUDY_BROKER_SOCKET:socketPath,DSH_PRIMARY_RUNTIME:'',DSH_PERMISSION_MODE:'read-only',NARB_DISABLE_NATIVE_CACHE:'1',
      NODE_OPTIONS:`--require=${JSON.stringify(join(ROOT,'tests/fixtures/deny-probe-network.cjs'))}`},stdio:['pipe','ignore','ignore']
  });
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  try{
    let catalog;const deadline=Date.now()+12000;
    while(Date.now()<deadline){try{catalog=JSON.parse(await readFile(file,'utf8'));break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    assert(catalog&&!catalog.error,'Subscription-loaded agent catalog unavailable');
    assert(catalog.globalNames.includes('image_generate'),'negative control: plugin extra tool must actually be registered');
    assert.deepEqual(catalog.names,['ask_user_question','mcp__study__draft_study_plan','mcp__study__inspect_checkpoint','mcp__study__list_calendar',
      'mcp__study__list_synthetic_files','mcp__study__read_synthetic_file','mcp__study__routine_report','mcp__study__save_report_interpretation'].sort());
    assert.deepEqual(catalog.model,{provider:'codex',model:'gpt-6-luna'});
    assert.equal(catalog.studyDenial,null);
    assert.equal(catalog.modelAttempts,0);
    assert.equal(catalog.hostClockInjected,false,'Synthetic planning must not inject the real host clock');
    assert.equal(catalog.preStepPassed,true,catalog.preStepError||'Pre-step policy did not complete');
    for(const [name,denial] of Object.entries(catalog.denials))assert.match(denial||'',/not available/i,name);
    console.log(JSON.stringify({kind:'actual-plugin-catalog',names:catalog.names,model:catalog.model,extraToolHidden:true,generativeRequests:catalog.modelAttempts}));
  }finally{
    child.kill('SIGTERM');await exited.catch(()=>{});await broker.close();await rm(directory,{recursive:true,force:true});
  }
});
