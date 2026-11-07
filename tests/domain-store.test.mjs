import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { DomainStore } from '../src/domain-store.mjs';

function seeded(store,student='ana') {
  for(const kind of ['context','evidence','calendar'])store.addRevision(student,kind,{kind,original:true},0);
  return store.currentVersions(student);
}
test('proposal and decision history is versioned, scoped and immutable',()=>{
  const store=new DomainStore();
  try {
    const versions=seeded(store), input={blocks:[{name:'Study'}]};
    const proposal=store.createProposal('ana',versions,input);
    input.blocks[0].name='Modified outside the store';
    assert.equal(store.getProposal('ana',proposal.id).payload.blocks[0].name,'Study');
    assert.equal(store.getProposal('bruno',proposal.id),null);
    assert.equal(store.getDecision('ana',proposal.id,'near'),null);
    store.decide('ana',proposal.id,'near','approve');
    store.decide('ana',proposal.id,'future','reject');
    assert.equal(store.getDecision('ana',proposal.id,'near').choice,'approve');
    assert.equal(store.getDecision('ana',proposal.id,'future').choice,'reject');
    assert.throws(()=>store.decide('ana',proposal.id,'near','approve'),/already decided/);
    assert.equal(store.assertApprovalCurrent('ana',proposal.id,'near').choice,'approve');
    assert.throws(()=>store.assertApprovalCurrent('ana',proposal.id,'future'),/not approved/);
    store.addRevision('ana','calendar',{changed:true},1);
    assert.throws(()=>store.assertApprovalCurrent('ana',proposal.id,'near'),/STALE/);
    assert.throws(()=>store.decide('ana',proposal.id,'near','approve'),/STALE/);
    assert.throws(()=>store.db.prepare('UPDATE proposals SET payload=? WHERE id=?').run('{}',proposal.id),/immutable/);
    assert.throws(()=>store.db.prepare('DELETE FROM decisions WHERE proposal_id=?').run(proposal.id),/immutable/);
  } finally { store.close(); }
});
test('all source changes invalidate old proposals and cannot record approval',()=>{
  for(const kind of ['context','evidence','calendar']){
    const store=new DomainStore();
    try {
      const versions=seeded(store), proposal=store.createProposal('ana',versions,{blocks:[]});
      store.addRevision('ana',kind,{changed:true},1);
      assert.throws(()=>store.decide('ana',proposal.id,'near','approve'),/STALE/);
      assert.equal(store.getDecision('ana',proposal.id,'near'),null);
      assert.throws(()=>store.createProposal('ana',versions,{blocks:[]}),/STALE/);
      assert.equal(store.getRevision('ana',kind,1).payload.original,true);
      assert.equal(store.getRevision('ana',kind,2).payload.changed,true);
    } finally { store.close(); }
  }
});
test('expected versions prevent lost updates across store connections',()=>{
  const dir=mkdtempSync(join(tmpdir(),'domain-store-')), filename=join(dir,'state.sqlite');
  const one=new DomainStore(filename), two=new DomainStore(filename);
  try {
    seeded(one);
    const observed=two.currentVersions('ana');
    one.addRevision('ana','context',{who:'first'},observed.context);
    assert.throws(()=>two.addRevision('ana','context',{who:'second'},observed.context),/STALE/);
    assert.equal(two.currentVersions('ana').context,2);
    assert.equal(two.getRevision('ana','context',2).payload.who,'first');
    assert.equal(two.getRevision('ana','context',3),null);
  } finally { one.close();two.close();rmSync(dir,{recursive:true,force:true}); }
});
test('concurrent writers cannot both commit against one observed version',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'domain-concurrent-')), filename=join(dir,'state.sqlite');
  const store=new DomainStore(filename);
  seeded(store); store.close();
  const moduleUrl=new URL('../src/domain-store.mjs',import.meta.url).href;
  const code=`const { parentPort, workerData }=require('node:worker_threads');
    import(workerData.url).then(({DomainStore})=>{const s=new DomainStore(workerData.filename);
      try { s.addRevision('ana','context',{worker:workerData.worker},1); parentPort.postMessage('ok'); }
      catch(e) { parentPort.postMessage(e.message); } finally {s.close();}
    }).catch(e=>{throw e;});`;
  function run(worker){return new Promise((resolve,reject)=>{
    const instance=new Worker(code,{eval:true,workerData:{filename,url:moduleUrl,worker}});
    instance.once('message',resolve);instance.once('error',reject);
  });}
  try {
    const outcomes=await Promise.all([run(1),run(2)]);
    assert.equal(outcomes.filter(x=>x==='ok').length,1);
    assert.equal(outcomes.filter(x=>x.includes('STALE')).length,1);
    const inspect=new DomainStore(filename);
    try { assert.equal(inspect.currentVersions('ana').context,2); }
    finally { inspect.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
