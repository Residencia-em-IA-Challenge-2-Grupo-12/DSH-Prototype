import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeScenario} from '../src/core.mjs';
import {createTrustedStudyService} from '../src/foundation/trusted-study-service.mjs';

test('trusted retirement drains approved writes and broker calls before snapshot',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
  let release,started;const entered=new Promise(resolve=>{started=resolve;});
  const calendar={items:structuredClone(fixture.events),async events(){return structuredClone(this.items);},
    async create(_student,event){started();await new Promise(resolve=>{release=resolve;});this.items.push(structuredClone(event));return event;}};
  await initializeScenario(calendar,'ana');const service=createTrustedStudyService({student:'ana',calendar});
  const plan=await service.agent.call('draft_study_plan',{student:'ana',weeks:1,hours:1});
  const applying=service.approvePlan(plan.id,'near');await entered;
  let done=false;const draining=service.drain().then(()=>{done=true;});
  await assert.rejects(service.agent.call('list_calendar',{student:'ana'}),/retir|drain|closed/i);
  await assert.rejects(service.approvePlan(plan.id,'near'),/retir|drain|closed/i);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
  release();await applying;await draining;
  const snapshot=await service.snapshotForArchive();
  assert.equal(snapshot.claim,null);assert.equal(snapshot.claimHistory[0].decision.kind,'approved');
  assert.equal(snapshot.state.plan.status.near,'applied');
});

test('a forced drain does not claim an in-process writer has stopped',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
  let release,started;const entered=new Promise(resolve=>{started=resolve;});
  const calendar={items:structuredClone(fixture.events),async events(){return structuredClone(this.items);},
    async create(_student,event){started();await new Promise(resolve=>{release=resolve;});this.items.push(structuredClone(event));return event;}};
  await initializeScenario(calendar,'ana');const service=createTrustedStudyService({student:'ana',calendar});
  const plan=await service.agent.call('draft_study_plan',{student:'ana',weeks:1,hours:1});
  const applying=service.approvePlan(plan.id,'near');await entered;
  await assert.rejects(service.drain({force:true}),/writer|process/i);
  await assert.rejects(service.snapshotForArchive(),/drain|retir/i);
  release();await applying;await service.drain();assert((await service.snapshotForArchive()).state);
});
