import test from 'node:test';
import assert from 'node:assert/strict';
import {createWriteGate} from '../src/foundation/write-gate.mjs';

test('retirement waits for an active write and blocks new writes',async()=>{
  const gate=createWriteGate();let release,started,drained=false;
  const entered=new Promise(resolve=>{started=resolve;});
  const writing=gate.run(async()=>{started();await new Promise(resolve=>{release=resolve;});return 'acknowledged';});
  await entered;
  const draining=gate.drain().then(()=>{drained=true;});
  await assert.rejects(gate.run(async()=>{}),/retir|drain|closed/i);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);
  release();assert.equal(await writing,'acknowledged');await draining;assert.equal(drained,true);
  await assert.rejects(gate.run(async()=>{}),/retir|drain|closed/i);
});

test('force cannot pretend an in-process writer was interrupted',async()=>{
  const gate=createWriteGate();let release,started;
  const entered=new Promise(resolve=>{started=resolve;});
  const writing=gate.run(async()=>{started();await new Promise(resolve=>{release=resolve;});});await entered;
  await assert.rejects(gate.drain({force:true}),/writer|process/i);
  await assert.rejects(gate.run(async()=>{}),/retir|drain|closed/i);
  release();await writing;await gate.drain();
});
