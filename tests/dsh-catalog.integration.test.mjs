import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ROOT} from '../src/core.mjs';

test('the actual DSH profile exposes the study tools but not native host tools', {timeout:20000}, async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-dsh-catalog-')),file=join(directory,'catalog.json');
  const child=spawn(process.execPath,[`${ROOT}/node_modules/@deepseek-ai/dsh/lib/bin.js`,'--profile','sdk',
    '--patch',`${ROOT}/dsh-study.patch.yml`,'--patch',`${ROOT}/tests/fixtures/dsh-catalog-audit.patch.yml`],{
    cwd:ROOT,env:{PATH:process.env.PATH,DSH_HOME:directory,STUDY_TOOL_AUDIT_FILE:file,DSH_PRIMARY_RUNTIME:'',DSH_PERMISSION_MODE:'read-only'},stdio:['pipe','ignore','pipe']
  });
  let diagnostic='';child.stderr.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-4000);});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>resolve(code));});
  try {
    let catalog;const deadline=Date.now()+12000;
    while(Date.now()<deadline){try{catalog=JSON.parse(await readFile(file,'utf8'));if(catalog.names.some(name=>name.startsWith('mcp__study__')))break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    assert(catalog?.names?.includes('mcp__study__list_synthetic_files'),'study MCP tools did not register; catalog='+JSON.stringify(catalog)+' stderr='+diagnostic);
    assert(catalog.names.includes('ask_user_question'),'native questions were not registered');
    for(const name of ['bash','read','write','edit','glob','grep','web_fetch','plugin_manager','subagent','run_code'])assert(!catalog.names.includes(name),`unsafe tool exposed: ${name}`);
    assert.deepEqual(catalog.names,[
      'ask_user_question','mcp__study__draft_study_plan','mcp__study__inspect_checkpoint','mcp__study__list_calendar',
      'mcp__study__list_synthetic_files','mcp__study__read_synthetic_file','mcp__study__routine_report','mcp__study__save_report_interpretation'
    ].sort(),'the model-facing tool catalog must be limited to the approved study tools');
    assert.match(catalog.denial||'',/not available/i,'unknown or native tools must be denied at dispatch');
    assert.equal(catalog.studyDenial,null,'the intended synthetic calendar tool must remain usable');
  } finally {child.kill('SIGTERM');await exited.catch(()=>{});await rm(directory,{recursive:true,force:true});}
});
