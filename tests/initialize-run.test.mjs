import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOT,readJSON,initializeScenario,loadState,readWorkspace} from '../src/core.mjs';

test('initializing a fresh run reads its seeded provider without resetting it',async()=>{
  let resetCalled=false;
  const events=(await readJSON(`${ROOT}/fixtures/calendars/ana.json`)).events;
  const calendar={events:async()=>structuredClone(events),reset:async()=>{resetCalled=true;}};
  const state=await initializeScenario(calendar,'ana');
  assert.equal(resetCalled,false);
  assert.equal(state.student,'ana');
  assert.equal((await loadState('ana')).student,'ana');
  assert.match(await readWorkspace('ana','courses/machine-learning.md'),/2026-11-30/);
  await assert.rejects(()=>initializeScenario(calendar,'ana'),/already initialized/i);
  assert.equal(resetCalled,false);
});
