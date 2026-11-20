import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireControllerLease} from '../src/foundation/controller-lease.mjs';

test('only one trusted controller holds a lease until it is released',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-controller-'));let first,second;
  try {
    first=await acquireControllerLease({directory});first.assertHeld();
    await assert.rejects(acquireControllerLease({directory}),/already active/i);
    await first.release();assert.throws(()=>first.assertHeld(),/not held/i);
    second=await acquireControllerLease({directory});second.assertHeld();
  } finally {await first?.release();await second?.release();await rm(directory,{recursive:true,force:true});}
});

test('a crashed controller releases its operating-system lock',{timeout:10000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-controller-crash-'));
  const url=new URL('../src/foundation/controller-lease.mjs',import.meta.url).href;
  const source=`import {acquireControllerLease} from ${JSON.stringify(url)}; const lease=await acquireControllerLease({directory:process.argv[1]}); lease.assertHeld(); console.log('ready'); setInterval(()=>lease.assertHeld(),1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',source,directory],{stdio:['ignore','pipe','pipe']});
  let diagnostic='';child.stderr.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-2000);});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(_code,signal)=>resolve(signal));});let lease;
  try {
    const ready=await Promise.race([new Promise(resolve=>createInterface({input:child.stdout}).once('line',resolve)),exited.then(()=>{throw new Error(`Controller exited before readiness: ${diagnostic}`);}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error(`Controller readiness timed out: ${diagnostic}`)),4000);timer.unref();})]);assert.equal(ready,'ready');
    await assert.rejects(acquireControllerLease({directory}),/already active/i);
    child.kill('SIGKILL');assert.equal(await exited,'SIGKILL');
    lease=await acquireControllerLease({directory});lease.assertHeld();
  } finally {child.kill('SIGKILL');await exited.catch(()=>{});await lease?.release();await rm(directory,{recursive:true,force:true});}
});
