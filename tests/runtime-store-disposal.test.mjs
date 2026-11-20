import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readlink,readdir,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {saveState,withSyntheticRuntime} from '../src/core.mjs';
import {createStateStore} from '../src/state-store.mjs';
import {createSyntheticRunDriver} from '../src/foundation/synthetic-run-driver.mjs';

async function sqliteDescriptors(directory){
  const descriptors=await readdir('/proc/self/fd'),matches=[];
  for(const descriptor of descriptors){
    try {const target=await readlink(`/proc/self/fd/${descriptor}`);if(target.startsWith(directory+path.sep)&&target.includes('state.sqlite'))matches.push(target);}
    catch {}
  }
  return matches;
}

test('verified retirement releases cached runtime stores across repeated runs',{skip:process.platform!=='linux'},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'study-runtime-store-disposal-'));
  const agentImage='sha256:'+'a'.repeat(64),gatewayId='b'.repeat(64),lease={assertHeld(){}};
  const driver=createSyntheticRunDriver({root,lease,agentImage,gatewayId,tokenFile:path.join(root,'gateway-token'),
    runDocker:async(...args)=>{
      if(args[0]==='ps'||(args[0]==='network'&&args[1]==='ls'))return '';
      throw new Error(`Unexpected Docker command: ${args.join(' ')}`);
    }});
  try {
    for(let i=0;i<4;i++){
      const id=randomUUID(),run={id,student:'ana'},directory=path.join(root,'runs',id);
      await mkdir(directory,{recursive:true,mode:0o700});
      await writeFile(path.join(directory,'run-manifest.json'),JSON.stringify({version:1,id,student:'ana',gatewayId,agentImage}),{mode:0o600});
      await withSyntheticRuntime(directory,()=>saveState('ana',{student:'ana',probe:i}));
      assert.equal((await sqliteDescriptors(directory)).length,3,'runtime DB and WAL handles should be open before retirement');
      await driver.archive({...run,createdAt:new Date().toISOString()});
      assert((await sqliteDescriptors(directory)).length>=3,'the runtime store should remain available for retirement retries after archival');
      assert.equal(await driver.verifyRetired(run),true);
      assert.deepEqual(await sqliteDescriptors(directory),[],`runtime ${i} should release all SQLite handles after verified retirement`);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

test('an explicitly owned state store can release its SQLite handles',{skip:process.platform!=='linux'},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'study-owned-state-store-'));
  const store=createStateStore(directory);
  try {
    await store.getCalendarClaim();
    assert.equal((await sqliteDescriptors(directory)).length,3);
    await store.close();
    assert.deepEqual(await sqliteDescriptors(directory),[]);
    await assert.rejects(store.getCalendarClaim(),/closed/i);
  } finally {await store.close();await rm(directory,{recursive:true,force:true});}
});
