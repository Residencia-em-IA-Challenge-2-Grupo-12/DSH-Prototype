import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeScenario,loadState,withSyntheticRuntime} from '../src/core.mjs';
import {createTrustedStudyService} from '../src/foundation/trusted-study-service.mjs';

test('trusted services keep simultaneous synthetic run state in their own directories',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-runtime-context-')),first=join(root,'one'),second=join(root,'two');
  try {
    const fixture=JSON.parse(await readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
    const calendar=()=>({events:async()=>structuredClone(fixture.events)}),one=calendar(),two=calendar();
    await Promise.all([withSyntheticRuntime(first,()=>initializeScenario(one,'ana')),withSyntheticRuntime(second,()=>initializeScenario(two,'ana'))]);
    const serviceOne=createTrustedStudyService({student:'ana',calendar:one,runtimeDirectory:first});
    const serviceTwo=createTrustedStudyService({student:'ana',calendar:two,runtimeDirectory:second});
    const [planOne,planTwo]=await Promise.all([
      serviceOne.agent.call('draft_study_plan',{student:'ana',weeks:1,hours:1}),
      serviceTwo.agent.call('draft_study_plan',{student:'ana',weeks:1,hours:2})
    ]);
    assert.notEqual(planOne.id,planTwo.id);
    assert.equal((await withSyntheticRuntime(first,()=>loadState('ana'))).plan.id,planOne.id);
    assert.equal((await withSyntheticRuntime(second,()=>loadState('ana'))).plan.id,planTwo.id);
    await serviceOne.drain();await serviceTwo.drain();
  } finally {await rm(root,{recursive:true,force:true});}
});
