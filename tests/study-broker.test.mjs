import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startStudyBroker,createStudyBrokerClient} from '../src/foundation/study-broker.mjs';

test('the local agent broker forwards only to its supplied service and fails closed on disconnect',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-broker-')),socketPath=join(directory,'agent.sock');
  const calls=[];let server;
  try {
    server=await startStudyBroker({socketPath,boundary:{async call(method,args){calls.push({method,args});if(method!=='list_calendar')throw new Error('Agent operation is not available');return {events:[{id:'synthetic'}]};}}});
    assert.equal((await stat(socketPath)).mode&0o777,0o600);
    const client=createStudyBrokerClient({socketPath});
    assert.equal(await client.ping(),true);
    assert.deepEqual(await client.call('list_calendar',{student:'ana'}),{events:[{id:'synthetic'}]});
    await assert.rejects(client.call('approve',{student:'ana'}),/not available/i);
    assert.equal(calls.length,2);
    await server.close();server=null;
    await assert.rejects(client.call('list_calendar',{student:'ana'}));
    await assert.rejects(client.ping());
  } finally {await server?.close();await rm(directory,{recursive:true,force:true});}
});

test('a broker never replaces an existing socket path or uses a public directory',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-broker-path-')),socketPath=join(directory,'agent.sock');
  try {
    await writeFile(socketPath,'do not overwrite');
    await assert.rejects(startStudyBroker({socketPath,boundary:{call:async()=>null}}));
    assert.equal(await readFile(socketPath,'utf8'),'do not overwrite');
    await rm(socketPath);await chmod(directory,0o755);
    await assert.rejects(startStudyBroker({socketPath,boundary:{call:async()=>null}}),/private/i);
  } finally {await rm(directory,{recursive:true,force:true});}
});
