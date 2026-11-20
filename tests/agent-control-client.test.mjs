import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {attachAgentControl} from '../src/agent-control.mjs';
import {createAgentControlClient} from '../src/foundation/agent-control-client.mjs';

test('trusted client can drive conversation but exposes no calendar approval',async()=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();let stopped=0;
  const session={snapshot:()=>({student:'ana',busy:false}),async prompt(text){assert.equal(text,'Synthetic prompt');},answer(){},cancelQuestion(){},stop(){stopped++;}};
  const agent=attachAgentControl({session,input:child.stdin,output:child.stdout});
  const client=createAgentControlClient({child});
  try {
    assert.equal((await client.snapshot()).student,'ana');
    assert.equal((await client.prompt('Synthetic prompt')).student,'ana');
    assert.equal('approve' in client,false);
  } finally {client.close();agent.close();child.stdout.end();}
  assert.equal(stopped,1);
});

test('an interrupted or timed-out agent control request fails without a retry',async()=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();let writes=0;
  child.stdin.on('data',()=>writes++);
  const client=createAgentControlClient({child,timeoutMs:20});
  try {
    await assert.rejects(client.prompt('Synthetic prompt'),/timed out/i);assert.equal(writes,1);
    const pending=client.snapshot();child.emit('exit',1);await assert.rejects(pending,/stopped/i);
    await assert.rejects(client.snapshot(),/stopped/i);
  } finally {client.close();child.stdout.end();}
});
