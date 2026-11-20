import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedStudyApi} from '../src/foundation/managed-study-api.mjs';

test('managed API rejects stale identities before an approval or chat action',async()=>{
  let calls=0;const run={id:'run-a',student:'bruno',phase:'active'};
  const manager={current:async()=>run};
  const driver={active:()=>({id:'run-a',student:'bruno',service:{approvePlan:async()=>{calls++;}},client:{prompt:async()=>{calls++;}}})};
  const api=createManagedStudyApi({manager,driver});
  await assert.rejects(api.approve('run-old','proposal','near'),/run.*changed|stale/i);
  await assert.rejects(api.prompt('run-old','hello'),/run.*changed|stale/i);
  assert.equal(calls,0);
});

test('managed API refuses operations after controller restart until the run is resolved',async()=>{
  const manager={current:async()=>({id:'run-a',student:'bruno',phase:'active'})};
  const api=createManagedStudyApi({manager,driver:{active:()=>null}});
  assert.deepEqual(await api.runStatus(),{run:{id:'run-a',student:'bruno',phase:'active'},available:false});
  await assert.rejects(api.prompt('run-a','hello'),/unavailable|resolve/i);
});
