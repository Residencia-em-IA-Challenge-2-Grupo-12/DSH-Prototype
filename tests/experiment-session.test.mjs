import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperimentSession} from '../src/foundation/experiment-session.mjs';

test('conversation capture records actions and each observed assistant message once',async()=>{
  const events=[];const trace={append:async(kind,data)=>events.push({kind,data})};
  const view={student:'bruno',busy:false,question:{requestId:'q1',questions:[{id:'a',question:'How much time?'}]},messages:[{id:'m1',type:'assistant',text:'What time works?'}]};
  const client={snapshot:async()=>view,prompt:async()=>view,answer:async()=>view,cancelQuestion:async()=>view,close(){}};
  const session=createExperimentSession({client,trace});
  await session.prompt('Plan');await session.snapshot();await session.answer('q1',[{id:'a',custom:'Three hours'}]);
  assert.equal(events.filter(e=>e.kind==='message'&&e.data.role==='assistant').length,1);
  assert.equal(events.filter(e=>e.kind==='question'&&e.data.phase==='observed').length,1);
  assert(events.some(e=>e.kind==='message'&&e.data.text==='Plan'));
  assert(events.some(e=>e.kind==='question'&&e.data.phase==='answer'));
});

test('failure to capture a prompt blocks it before it reaches the agent',async()=>{
  let invoked=false;const session=createExperimentSession({client:{prompt:async()=>{invoked=true;}},trace:{append:async()=>{throw Error('disk full');}}});
  await assert.rejects(session.prompt('Plan'),/disk full/);assert.equal(invoked,false);
});

test('evidence failure after an agent action reports that state may have changed',async()=>{
  let writes=0;const session=createExperimentSession({client:{prompt:async()=>({messages:[{id:'m',type:'assistant',text:'Done'}]})},
    trace:{append:async()=>{if(++writes===2)throw Error('disk full');}}});
  await assert.rejects(session.prompt('Plan'),/state may have changed/i);
});
