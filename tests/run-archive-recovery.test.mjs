import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT,runtimeDir,readJSON,resetScenario,draft,applyApproved,getRecoveryClaim} from '../src/core.mjs';
import {createStateStore} from '../src/state-store.mjs';
import {archiveSyntheticRun} from '../src/foundation/run-archive.mjs';

test('an uncertain write can be archived without inventing a calendar observation or retrying',async()=>{
  let writes=0;
  const calendar={
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);},
    async create(_student,event){writes++;this.items.push(structuredClone(event));throw new Error('synthetic lost response');},
    async remove(_student,id){this.items=this.items.filter(event=>event.id!==id);}
  };
  await resetScenario(calendar,'ana');const plan=await draft(calendar,'ana',{weeks:1,hours:1});
  await assert.rejects(applyApproved(calendar,'ana',plan.id,'near'),/outcome unknown/);
  const id=randomUUID(),directory=join(runtimeDir(),'archives');
  const snapshot=await createStateStore(runtimeDir()).snapshotForArchive('ana');
  await archiveSyntheticRun({directory,run:{id,student:'ana',createdAt:'2026-11-02T00:00:00Z'},snapshot,observation:{availability:'unavailable',events:null}});
  const record=JSON.parse(await readFile(join(directory,`${id}.json`),'utf8'));
  assert.equal(record.snapshot.claim.decision.kind,'approved');
  assert.equal(record.snapshot.claim.steps.at(-1).status,'sent');
  assert.equal(record.snapshot.state.history.at(-1).unknownAction.id,plan.near[0].id);
  assert.equal(record.observation.availability,'unavailable');assert.equal(record.observation.events,null);
  assert.equal((await getRecoveryClaim()).id,record.snapshot.claim.id);assert.equal(writes,1);
});
