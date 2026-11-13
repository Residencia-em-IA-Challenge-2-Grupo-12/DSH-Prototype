import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createExperimentTrace} from '../src/foundation/experiment-trace.mjs';

test('synthetic trace persists ordered evidence without credential fields',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'study-trace-'));
  try {
    const trace=await createExperimentTrace({directory:dir,runId:'synthetic-run',attemptId:'attempt-1'});
    await Promise.all([
      trace.append('message',{role:'user',text:'Help Bruno study',authorization:'Bearer synthetic-secret'}),
      trace.append('tool',{name:'list_calendar',result:{events:[{id:'event-1'}],apiKey:'synthetic-secret'}})
    ]);
    const rows=(await readFile(join(dir,'trace.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row=>row.sequence),[1,2]);
    assert.equal(rows[0].data.text,'Help Bruno study');assert.equal(rows[1].data.result.events[0].id,'event-1');
    assert(!JSON.stringify(rows).includes('synthetic-secret'));assert.equal((await stat(join(dir,'trace.jsonl'))).mode&0o077,0);
    await assert.rejects(trace.append('environment',{OPENROUTER_API_KEY:'synthetic-secret'}),/event type/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('trace refuses existing files and non-private directories',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'study-trace-boundary-'));
  try {
    await chmod(dir,0o755);
    await assert.rejects(createExperimentTrace({directory:dir,runId:'run',attemptId:'a'}),/private/i);
    await chmod(dir,0o700);
    await createExperimentTrace({directory:dir,runId:'run',attemptId:'a'});
    await assert.rejects(createExperimentTrace({directory:dir,runId:'run',attemptId:'b'}),{code:'EEXIST'});
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('a failed evidence write leaves the trace unhealthy',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'study-trace-failure-'));
  try {
    const trace=await createExperimentTrace({directory:dir,runId:'run',attemptId:'a'});
    await rm(join(dir,'trace.jsonl'));
    await assert.rejects(trace.append('message',{text:'Synthetic'}));
    assert.equal(trace.healthy(),false);
    await assert.rejects(trace.append('message',{text:'Retry'}));
  } finally {await rm(dir,{recursive:true,force:true});}
});
