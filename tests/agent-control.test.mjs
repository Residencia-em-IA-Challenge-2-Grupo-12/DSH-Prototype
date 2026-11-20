import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {attachAgentControl} from '../src/agent-control.mjs';

test('agent control exposes conversation operations but no calendar approval',async()=>{
  const input=new PassThrough(),output=new PassThrough(),pending=new Map();let stopped=0;
  const session={snapshot:()=>({student:'ana',busy:false,messages:[]}),async prompt(text){assert.equal(text,'Synthetic prompt');},
    answer(id,answers){assert.equal(id,'q1');assert.deepEqual(answers,[]);},cancelQuestion(){},stop(){stopped++;}};
  createInterface({input:output}).on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);});
  const control=attachAgentControl({session,input,output});
  const request=(id,op,body={})=>new Promise(resolve=>{pending.set(id,resolve);input.write(JSON.stringify({id,op,...body})+'\n');});
  try {
    assert.equal((await request(1,'snapshot')).result.student,'ana');
    assert.equal((await request(2,'prompt',{text:'Synthetic prompt'})).result.student,'ana');
    assert.equal((await request(3,'answer',{requestId:'q1',answers:[]})).result.student,'ana');
    assert.match((await request(4,'approve',{planId:'p'})).error,/not available/i);
    assert.equal(stopped,0);
  } finally {control.close();input.end();output.end();}
  assert.equal(stopped,1);
});
