import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryView} from '../public/recovery-view.js';

test('an unresolved approval is never presented as applied or available for retry',()=>{
  const view=recoveryView({
    state:{plan:{status:{near:'applying',future:'pending'},near:[{id:'n'}],future:[{id:'f'}],remove:{}}},
    calendar:{availability:'unavailable'},events:null,
    recovery:{kind:'approval',actions:[{actionId:'create:n',type:'create',event:{summary:'Study'}}],steps:[{actionId:'create:n',status:'sent'}]}
  });
  assert.equal(view.calendarAvailable,false);
  assert.equal(view.canReset,false);
  assert.equal(view.sections.near.label,'applyingStatus');
  assert.equal(view.sections.near.canApprove,false);
  assert.equal(view.sections.future.canApprove,false);
  assert.deepEqual(view.actions,[{type:'create',label:'Study',status:'sent'}]);
});

test('review is available only for pending sections on an observed, unclaimed calendar',()=>{
  const plan={status:{near:'pending',future:'applied'},near:[{id:'n'}],future:[{id:'f'}],remove:{}};
  const view=recoveryView({state:{plan},calendar:{availability:'available'},events:[],recovery:null});
  assert.equal(view.sections.near.label,'approve');
  assert.equal(view.sections.near.canApprove,true);
  assert.equal(view.sections.future.label,'applied');
  assert.equal(view.sections.future.canApprove,false);
  assert.equal(view.calendarAvailable,true);
  assert.equal(view.canReset,true);
});

test('a missing persona calendar can be initialized but an offline simulator cannot be reset',()=>{
  assert.equal(recoveryView({state:null,calendar:{availability:'not_found'},events:null}).canReset,true);
  assert.equal(recoveryView({state:null,calendar:{availability:'unavailable'},events:null}).canReset,false);
});
