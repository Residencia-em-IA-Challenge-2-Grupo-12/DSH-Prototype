import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runBoundedProcess} from './bounded-process.mjs';

const options={env:{PATH:process.env.PATH},timeout:5000,maxBytes:1024};
test('cancelled running process terminates without needing Docker', {timeout:10000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bounded-process-test-'));
  const marker=join(dir,'started');
  const controller=new AbortController();
  const program="require('node:fs').writeFileSync(process.argv[1], 'ready'); setInterval(()=>{},1000)";
  const running=runBoundedProcess(process.execPath,['-e',program,marker],{...options,signal:controller.signal});
  running.catch(()=>{});
  try {
    let observed=false;
    const deadline=Date.now()+4000;
    while(Date.now()<deadline&&!observed){
      try {observed=(await readFile(marker,'utf8'))==='ready';}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!observed)await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(observed,true,'child process did not start');
    controller.abort('private reason');
    await assert.rejects(running,error=>error.name==='AbortError'&&!error.message.includes('private reason'));
  } finally {controller.abort();await running.catch(()=>{});await rm(dir,{recursive:true,force:true});}
});

test('process output and timeout limits terminate work without Docker', {timeout:10000},async()=>{
  await assert.rejects(runBoundedProcess('/usr/bin/head',['-c','2048','/dev/zero'],options),/Output limit exceeded/);
  await assert.rejects(runBoundedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{...options,timeout:100}),/timed out/);
});

test('already cancelled process does not spawn',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(runBoundedProcess('/does/not/exist',[],{...options,signal:controller.signal}),error=>error.name==='AbortError');
});
