import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {initializeScenario,loadState,runtimeDir,ROOT} from '../src/core.mjs';
import {createStudyBoundary} from '../src/foundation/study-boundary.mjs';

test('a student-bound agent can inspect context and draft but cannot approve or write',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
  let writes=0;const calendar={events:async student=>{assert.equal(student,'ana');return structuredClone(fixture.events);},
    create:async()=>{writes++;throw new Error('agent must not write');},remove:async()=>{writes++;throw new Error('agent must not write');}};
  await initializeScenario(calendar,'ana');
  const service=createStudyBoundary({student:'ana',calendar});
  const files=await service.call('list_synthetic_files',{student:'ana'});
  assert(files.length>0);
  const events=await service.call('list_calendar',{student:'ana'});
  assert(events.events.length>0);
  const plan=await service.call('draft_study_plan',{student:'ana',weeks:2,hours:2});
  assert(plan.near.length>0);
  assert.equal((await loadState('ana')).plan.id,plan.id);
  assert.equal(writes,0);
  await assert.rejects(service.call('applyApproved',{student:'ana',planId:plan.id,section:'near'}),/not available/i);
  await assert.rejects(service.call('create',{student:'ana'}),/not available/i);
  await assert.rejects(service.call('__proto__',{student:'ana'}),/not available/i);
  await assert.rejects(service.call('list_calendar',{student:'bruno'}),/student/i);
  await assert.rejects(service.call('read_synthetic_file',{student:'ana',path:'../../../../etc/passwd'}),/outside/i);
  assert.equal(writes,0);
  const staged=join(runtimeDir(),'workspaces','ana');await rm(staged,{recursive:true});
  await assert.rejects(service.call('list_synthetic_files',{student:'ana'}));
  await assert.rejects(service.call('draft_study_plan',{student:'ana',weeks:2,hours:2}));
  await symlink(join(ROOT,'fixtures/students/ana'),staged);
  await assert.rejects(service.call('list_synthetic_files',{student:'ana'}));
});
