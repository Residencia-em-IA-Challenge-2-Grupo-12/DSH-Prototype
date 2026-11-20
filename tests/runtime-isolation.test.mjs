import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('a selected synthetic runtime is shared with child processes without touching the default runtime',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-runtime-selection-'));
  try {
    const moduleUrl=new URL('../src/core.mjs',import.meta.url).href;
    const code=`import {runtimeDir} from ${JSON.stringify(moduleUrl)}; process.stdout.write(runtimeDir());`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',code],{
      env:{...process.env,STUDY_ATLAS_RUNTIME_DIR:directory},encoding:'utf8'
    });
    assert.equal(child.status,0,child.stderr);
    assert.equal(child.stdout,directory);
  } finally {await rm(directory,{recursive:true,force:true});}
});
