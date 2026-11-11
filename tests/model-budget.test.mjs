import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createModelBudget} from '../src/foundation/model-budget.mjs';

test('the shared local budget serializes paid calls and stops when usage is unknown',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-model-budget-'));let first,second;
  try {
    first=await createModelBudget({directory,targetUsd:5});
    const pending=await first.reserve({role:'agent',estimatedUsd:0.4});
    second=await createModelBudget({directory,targetUsd:5});
    await assert.rejects(()=>second.reserve({role:'judge',estimatedUsd:0.2}),/pending|unknown/i);
    await first.settle(pending.id,{actualUsd:0.17,inputTokens:1000,outputTokens:200});
    const next=await second.reserve({role:'judge',estimatedUsd:0.2});
    await second.settle(next.id,{actualUsd:null});
    const report=await first.summary();
    assert.equal(report.targetUsd,5);assert.equal(report.observedUsd,0.17);assert.equal(report.unknownCount,1);
    await assert.rejects(()=>first.reserve({role:'agent',estimatedUsd:0.1}),/pending|unknown/i);
  } finally {await first?.close();await second?.close();await rm(directory,{recursive:true,force:true});}
});

test('a new request is refused when its estimate exceeds the remaining target',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-model-budget-'));let budget;
  try {
    budget=await createModelBudget({directory,targetUsd:5});
    const request=await budget.reserve({role:'setup',estimatedUsd:4.99});
    await budget.settle(request.id,{actualUsd:4.99});
    await assert.rejects(()=>budget.reserve({role:'judge',estimatedUsd:0.02}),/exceed/i);
    await assert.rejects(()=>budget.reserve({role:'other-model',estimatedUsd:0.001}),/role/i);
    await assert.rejects(()=>createModelBudget({directory,targetUsd:10}),/\$5/i);
    assert.equal((await budget.summary()).observedUsd,4.99);
  } finally {await budget?.close();await rm(directory,{recursive:true,force:true});}
});
