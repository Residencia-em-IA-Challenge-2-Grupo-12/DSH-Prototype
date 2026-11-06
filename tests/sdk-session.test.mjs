import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { StudySession } from '../src/sdk-session.mjs';

function fakeHarness() {
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
  let waitId,sessionId,questionAnswered=false,approvalAnswer;
  const emit=frame=>child.stdout.write(JSON.stringify(frame)+'\n');
  child.stdin=new Writable({write(chunk,encoding,done){
    for(const line of chunk.toString().trim().split('\n')){
      const frame=JSON.parse(line);
      if(frame.method==='initialize') {
        assert.equal(frame.params.provider,'codex');assert.equal(frame.params.model,'gpt-6-luna');
        emit({jsonrpc:'2.0',id:frame.id,result:{serverInfo:{name:'test'}}});
      } else if(frame.method==='session/prompt') {
        sessionId=frame.params.sessionId;emit({jsonrpc:'2.0',id:frame.id,result:{messageId:'m1'}});
        emit({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type:'tool/call',data:{name:'ask_user_question'}}}});
        emit({jsonrpc:'2.0',id:'q1',method:'user-question/ask',params:{requestId:'request1',questions:[{id:'hours',question:'How many?',options:[{label:'3 hours'},{label:'5 hours'}]}]}});
        emit({jsonrpc:'2.0',id:'approval1',method:'approval/request',params:{}});
      } else if(frame.method==='session/wait') waitId=frame.id;
      else if(frame.id==='approval1') approvalAnswer=frame.result;
      else if(frame.id==='q1') {
        assert.deepEqual(frame.result,{answers:[{id:'hours',selected:['3 hours']}]});questionAnswered=true;
        emit({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type:'assistant/message',data:{message:{content:[{type:'text',text:'I will draft three hours.'}]}}}}});
        emit({jsonrpc:'2.0',id:waitId,result:{}});
      }
    }done();
  }});
  child.kill=()=>{child.killed=true;child.emit('exit',0);};
  return {child,get questionAnswered(){return questionAnswered;},get approvalAnswer(){return approvalAnswer;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('SDK conversation forwards a question and fails approval closed',async()=>{
  const fake=fakeHarness(), session=new StudySession('ana',{launch:()=>fake.child});
  await session.prompt('Help me plan');await flush();
  assert.equal(session.snapshot().busy,true);assert.equal(session.snapshot().question.questions[0].id,'hours');
  assert.deepEqual(fake.approvalAnswer,{outcome:'rejected'});
  assert.throws(()=>session.answer('wrong',[]),/no longer pending/);
  assert.throws(()=>session.answer('request1',[{id:'hours',selected:['not offered']}]),/Invalid answer/);
  session.answer('request1',[{id:'hours',selected:['3 hours']}]);await flush();
  assert(fake.questionAnswered);assert.equal(session.snapshot().busy,false);assert.equal(session.snapshot().question,null);
  assert(session.snapshot().messages.some(m=>m.type==='assistant'&&m.text.includes('three hours')));
  session.stop();assert(fake.child.killed);
});
