import test from 'node:test';
import assert from 'node:assert/strict';
import {StudySession} from '../src/sdk-session.mjs';

function setConnected(node,value){node.isConnected=value;for(const child of node.children)setConnected(child,value);}
class Element {
  constructor(tag,ownerDocument){this.tagName=tag.toUpperCase();this.ownerDocument=ownerDocument;this.children=[];this.parentNode=null;this._text='';this.value='';this.disabled=false;this.required=false;this.isConnected=false;this.dataset={};this.style={};this.scrollTop=0;this.scrollLeft=0;this.clientHeight=100;this.scrollHeight=100;}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const child of nodes){if(child.parentNode)child.parentNode.removeChild(child);child.parentNode=this;setConnected(child,this.isConnected);this.children.push(child);}}
  appendChild(node){this.append(node);return node;}
  removeChild(node){const index=this.children.indexOf(node);if(index>=0){this.children.splice(index,1);node.parentNode=null;setConnected(node,false);}return node;}
  replaceChildren(...nodes){for(const child of this.children){child.parentNode=null;child.isConnected=false;}this.children=[];this._text='';this.append(...nodes);}
  setAttribute(name,value){this[name]=String(value);}
  focus(){this.ownerDocument.activeElement=this;}
  contains(node){return this.children.some(child=>child===node||child.contains(node));}
}

class Document {
  constructor(){this.documentElement=new Element('html',this);this.documentElement.isConnected=true;this.elements=new Map();}
  createElement(tag){return new Element(tag,this);}
  createTextNode(text){const node=new Element('#text',this);node.textContent=text;return node;}
  getElementById(id){return this.elements.get(id);}
  add(id,value=''){const element=this.createElement('div');element.id=id;element.value=value;element.isConnected=true;this.elements.set(id,element);return element;}
}

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const response=(body,ok=true)=>({ok,json:async()=>body});
function buttonWithLabel(root,label){
  for(const section of root.children)for(const child of section.children)if(child.tagName==='BUTTON'&&child.textContent===label)return child;
  return null;
}

test('polling preserves proposal controls, approval is explicit and single-flight, and outcomes stay visible',async()=>{
  const document=new Document();globalThis.document=document;
  for(const [id,value] of [['language','en'],['student','ana']])document.add(id,value);
  for(const id of ['mode','start','retire','refresh','send','chat-title','calendar-title','proposal-title','approval-note','run','run-warning','notice','messages','question','calendar','proposal','chat','text'])document.add(id);
  document.documentElement.lang='en';
  let poll,approvalCalls=0,requestSection='',nearWrite=deferred(),futureWrite=deferred();
  const plan={id:'proposal-1',status:{near:'pending',future:'pending'},near:[{id:'near-1',summary:'Study'},],future:[{id:'future-1',summary:'Review'}],remove:{near:[],future:[]}};
  const state=()=>({state:{plan},recovery:null,calendar:{availability:'available'},events:[]});
  const chat={busy:false,error:null,messages:[{type:'user',text:'yes'}],question:{requestId:'question-1',questions:[{id:'preference',question:'Which time works?',options:[]}]}};
  globalThis.fetch=async(url,options={})=>{
    const route=new URL(url,'http://localhost').pathname;
    if(route==='/api/run')return response({run:{id:'run-1',student:'ana',phase:'active'},available:true});
    if(route==='/api/chat/state')return response(chat);
    if(route==='/api/status')return response(state());
    if(route==='/api/approve'){
      approvalCalls++;requestSection=JSON.parse(options.body).section;
      if(requestSection==='near'){await nearWrite.promise;plan.status.near='applied';return response({saved:true});}
      await futureWrite.promise;return response({error:'Approval refused'},false);
    }
    throw new Error(`Unexpected route ${route}`);
  };
  globalThis.setInterval=callback=>{poll=callback;return 1;};
  globalThis.confirm=()=>true;
  try {
    await import(`../public/managed.js?dom-test=${Date.now()}`);
    assert.equal(approvalCalls,0,'a chat response saying yes must not apply a proposal');
    const proposals=document.getElementById('proposal'),messages=document.getElementById('messages'),question=document.getElementById('question');
    const near=buttonWithLabel(proposals,'Approve coming week'),future=buttonWithLabel(proposals,'Approve future blocks');
    assert(near&&future,`both proposal sections have distinct approval controls: ${proposals.children.map(section=>section.children.map(child=>[child.tagName,child.textContent]))}`);
    assert.match(messages.children[0].textContent,/Youyes/);
    const messageNode=messages.children[0],questionInput=descendants(question,child=>child.tagName==='TEXTAREA')[0];
    questionInput.value='keep my draft';

    await poll();
    assert.equal(buttonWithLabel(proposals,'Approve coming week'),near,'unchanged polling must preserve the approval button node');
    assert.equal(messages.children[0],messageNode,'unchanged polling must preserve message nodes and scroll position');
    assert.equal(descendants(question,child=>child.tagName==='TEXTAREA')[0],questionInput,'unchanged polling must preserve form inputs');
    assert.equal(questionInput.value,'keep my draft');

    const pending=near.onclick();
    assert.equal(near.disabled,true,'approval becomes disabled before its request yields');
    await poll();
    assert.equal(proposals.children[0].children.at(-1),near,'an unchanged pending poll must not detach the control');
    assert.equal(near.disabled,true);
    await near.onclick();
    assert.equal(approvalCalls,1,'repeated clicks while approval is pending must not dispatch again');
    assert.equal(requestSection,'near');
    nearWrite.resolve();await pending;
    assert.equal(document.getElementById('notice').textContent,'Approved changes applied.');
    assert.notEqual(proposals.children[0].children.at(-1).textContent,'Applying…','a completed approval must clear pending text on replacement controls');
    assert.equal(proposals.children[0].children.at(-1).disabled,true,'applied sections cannot be approved twice');

    const rejected=buttonWithLabel(proposals,'Approve future blocks');
    const failure=rejected.onclick();
    assert.equal(rejected.disabled,true);
    assert.equal(approvalCalls,2);
    futureWrite.resolve();await failure;
    assert.equal(document.getElementById('notice').textContent,'Approval refused');
    await poll();
    assert.equal(document.getElementById('notice').textContent,'Approval refused','later polling must not clear an action error');
    document.getElementById('language').value='pt';await poll();
    assert(buttonWithLabel(proposals,'Aprovar blocos futuros'),'Portuguese retains the separate future approval control');
    assert.match(document.getElementById('approval-note').textContent,/não alteram o calendário/);
  } finally {
    delete globalThis.document;delete globalThis.fetch;delete globalThis.setInterval;delete globalThis.confirm;
  }
});


test('model prose renders basic formatting as text-safe DOM, with raw HTML and unsafe links inert',async()=>{
  const {appendMessageText}=await import('../public/chat-message.js');const document=new Document(),root=document.createElement('div');
  appendMessageText(root,'## Plan\n**Review** the proposal.\n- One block\n- Another block\n\n<script>alert(1)</script> [unsafe](javascript:alert(1))');
  assert.equal(root.children[0].tagName,'H3');assert(root.children.some(n=>n.tagName==='UL'));
  const tags=[];function walk(n){tags.push(n.tagName);n.children.forEach(walk);}walk(root);
  assert(tags.includes('STRONG'));assert(!tags.includes('SCRIPT'));assert(!tags.includes('A'));assert.match(root.textContent,/<script>/);
});


function descendants(root,predicate){return root.children.flatMap(child=>[...(predicate(child)?[child]:[]),...descendants(child,predicate)]);}

test('structured question controls send native selections or custom answers, survive polls/language changes and cancel separately',async()=>{
  const document=new Document();globalThis.document=document;
  for(const [id,value] of [['language','en'],['student','bruno']])document.add(id,value);
  for(const id of ['mode','start','retire','refresh','send','chat-title','calendar-title','proposal-title','approval-note','run','run-warning','notice','messages','question','calendar','proposal','chat','text'])document.add(id);
  const frames=[],session=new StudySession('bruno');session.child={stdin:{destroyed:false,write:line=>frames.push(JSON.parse(line))},kill(){}};session.busy=true;
  const ask=(requestId,questions)=>session.receive({id:'rpc-'+requestId,method:'user-question/ask',params:{requestId,questions}});
  const choices=[{label:'Algoritmos',description:'Graphs exam'},{label:'Banco de Dados',description:'Modeling project'}];
  ask('q1',[{id:'priority',question:'Which course?',options:choices},{id:'resources',question:'Which resources?',multiSelect:true,options:[{label:'Notes'},{label:'Laptop'}]},{id:'context',question:'What remains unknown?',options:[]}]);
  let poll,answerCalls=0,cancelCalls=0,approvalCalls=0,lastBody,sendAnswer=deferred();
  globalThis.fetch=async(url,options={})=>{
    const route=new URL(url,'http://localhost').pathname;
    if(route==='/api/run')return response({run:{id:'run-question',student:'bruno',phase:'active'},available:true});
    if(route==='/api/status')return response({state:{plan:null},recovery:null,calendar:{availability:'available'},events:[]});
    if(route==='/api/chat/state')return response(session.snapshot());
    if(route==='/api/chat/answer'){answerCalls++;lastBody=JSON.parse(options.body);await sendAnswer.promise;session.answer(lastBody.requestId,lastBody.answers);return response(session.snapshot());}
    if(route==='/api/chat/cancel-question'){cancelCalls++;session.cancelQuestion(JSON.parse(options.body).requestId);return response(session.snapshot());}
    if(route==='/api/approve'){approvalCalls++;throw Error('Questions cannot approve calendars');}
    throw Error('Unexpected route '+route);
  };
  globalThis.setInterval=callback=>{poll=callback;return 1;};globalThis.confirm=()=>true;
  const root=document.getElementById('question'),all=predicate=>descendants(root,predicate),form=()=>root.children[0];
  try{
    await import(`../public/managed.js?question-test=${Date.now()}`);
    let radios=all(n=>n.tagName==='INPUT'&&n.type==='radio'),checks=all(n=>n.tagName==='INPUT'&&n.type==='checkbox'),typed=all(n=>n.tagName==='TEXTAREA');
    assert.equal(radios.length,3,'single-select includes its two choices and explicit custom mode');assert.equal(checks.length,2);assert.equal(all(n=>n.tagName==='FIELDSET').length,3);
    assert.match(root.textContent,/Graphs exam/,'option descriptions remain visible');
    await form().onsubmit({preventDefault(){}});assert.equal(answerCalls,0,'blank answers do not cross the API');assert.equal(document.activeElement,radios[0]);
    radios[0].checked=true;radios[0].onchange();checks[0].checked=true;checks[1].checked=true;typed[1].value='Paper also';typed[2].value='Mastery is unspecified';
    const oldForm=form();await poll();assert.equal(form(),oldForm);assert.equal(typed[2].value,'Mastery is unspecified');
    document.getElementById('language').value='pt';await poll();assert.match(root.textContent,/Enviar resposta/);
    typed=all(n=>n.tagName==='TEXTAREA');assert.equal(typed[2].value,'Mastery is unspecified','language changes preserve the draft');assert.equal(all(n=>n.type==='checkbox').filter(n=>n.checked).length,2);
    const sending=form().onsubmit({preventDefault(){}});assert.equal(answerCalls,1);assert(all(n=>n.tagName==='BUTTON').every(n=>n.disabled));
    await form().onsubmit({preventDefault(){}});assert.equal(answerCalls,1,'pending answers are single-flight');
    sendAnswer.resolve();await sending;
    assert.deepEqual(lastBody.answers,[{id:'priority',selected:['Algoritmos']},{id:'resources',selected:['Notes','Laptop'],custom:'Paper also'},{id:'context',selected:[],custom:'Mastery is unspecified'}]);
    assert.deepEqual(frames.at(-1).result,{answers:lastBody.answers});assert.equal(root.children.length,0);
    ask('q2',[{id:'priority',question:'Which course?',options:choices}]);await poll();
    typed=all(n=>n.tagName==='TEXTAREA');typed[0].value='x'.repeat(2001);typed[0].oninput();
    await form().onsubmit({preventDefault(){}});assert.equal(answerCalls,1,'overlong custom answers remain local');
    typed[0].value='Keep priority unknown';typed[0].oninput();
    await form().onsubmit({preventDefault(){}});assert.deepEqual(lastBody.answers,[{id:'priority',selected:[],custom:'Keep priority unknown'}]);
    ask('q3',[{id:'priority',question:'Which course?',options:choices}]);await poll();
    const obsoleteForm=form();ask('q4',[{id:'fresh',question:'New question',options:[]}]);await poll();
    await obsoleteForm.onsubmit({preventDefault(){}});assert.equal(answerCalls,2,'an obsolete form must not answer a new request');
    const cancel=all(n=>n.tagName==='BUTTON'&&n.type==='button')[0];assert(cancel);await cancel.onclick();
    assert.equal(cancelCalls,1);assert.deepEqual(frames.at(-1).result,{cancelled:true});assert.equal(approvalCalls,0);
  }finally{session.stop();delete globalThis.document;delete globalThis.fetch;delete globalThis.setInterval;delete globalThis.confirm;}
});

test('empty or non-JSON preview responses explain local access and uncertain mutations without retrying',async()=>{
  for(const [status,body,language] of [[405,'','en'],[200,'','pt'],[502,'<html>Proxy error</html>','en'],[403,JSON.stringify({error:'Local access required'}),'pt'],['network','','en']]){
    const document=new Document();globalThis.document=document;
    for(const [id,value] of [['language',language],['student','bruno']])document.add(id,value);
    for(const id of ['mode','start','retire','refresh','send','chat-title','calendar-title','proposal-title','approval-note','run','run-warning','notice','messages','question','calendar','proposal','chat','text'])document.add(id);
    let writes=0;globalThis.setInterval=()=>1;globalThis.confirm=()=>true;
    globalThis.fetch=async(url,options={})=>{
      if(options.method==='POST'){writes++;if(status==='network')throw Error('Internal proxy detail');return new Response(body,{status});}
      return new Response(JSON.stringify({run:null,available:false,runtime:'host-luna-fallback'}),{headers:{'content-type':'application/json'}});
    };
    try{
      await import(`../public/managed.js?preview-error=${status}-${language}-${Date.now()}`);
      await document.getElementById('start').onclick();
      const notice=document.getElementById('notice').textContent;
      assert.match(notice,status===403?/A solicitação falhou/:language==='pt'?/Não foi possível confirmar/:/Could not confirm/);
      assert.match(notice,language==='pt'?/máquina do facilitador/:/facilitator computer/);
      if(status!=='network')assert.match(notice,new RegExp('HTTP '+status));
      assert.doesNotMatch(notice,/Unexpected|Proxy error|Internal proxy detail|<html>/);
      assert.equal(writes,1,'a malformed response must not automatically replay a mutation');
      assert.equal(document.getElementById('send').disabled,true,'no active run cannot send chat');
    }finally{delete globalThis.document;delete globalThis.fetch;delete globalThis.setInterval;delete globalThis.confirm;}
  }
});

test('unchanged polls preserve archive confirmation focus and recovery guidance persists across reload and language changes',async()=>{
  const document=new Document();globalThis.document=document;
  for(const [id,value] of [['language','en'],['student','bruno']])document.add(id,value);
  for(const id of ['mode','start','retire','refresh','send','chat-title','calendar-title','proposal-title','approval-note','run','run-warning','notice','messages','question','calendar','proposal','chat','text','retire-confirm'])document.add(id);
  let poll,recovery={reason:'uncertain'};
  const plan={id:'proposal-recovery',status:{near:'pending',future:'pending'},near:[{id:'one',summary:'Study'}],future:[],remove:{near:[],future:[]}};
  globalThis.setInterval=callback=>{poll=callback;return 1;};
  globalThis.fetch=async url=>{
    const route=new URL(url,'http://localhost').pathname;
    if(route==='/api/run')return response({run:{id:'run-recovery',student:'bruno',phase:'active'},available:true});
    if(route==='/api/status')return response({state:{plan},recovery,calendar:{availability:'available'},events:[]});
    if(route==='/api/chat/state')return response({busy:false,messages:[],question:null});
    throw Error('Unexpected route '+route);
  };
  try{
    await import(`../public/managed.js?recovery-focus=${Date.now()}`);
    const warning=document.getElementById('run-warning');
    assert.match(warning.textContent,/Approval is disabled.*contact a maintainer/);
    assert.equal(buttonWithLabel(document.getElementById('proposal'),'Approve coming week').disabled,true);
    document.getElementById('retire').onclick();
    const panel=document.getElementById('retire-confirm'),confirm=descendants(panel,n=>n.tagName==='BUTTON')[0];
    assert.equal(document.activeElement,confirm);
    await poll();
    assert.equal(descendants(panel,n=>n.tagName==='BUTTON')[0],confirm);
    assert.equal(document.activeElement,confirm);
    assert.match(warning.textContent,/Approval is disabled/);
    document.getElementById('language').value='pt';await poll();
    assert.match(warning.textContent,/aprovação está desativada.*manutenção/);
    assert.notEqual(descendants(panel,n=>n.tagName==='BUTTON')[0],confirm,'language changes update the confirmation');
    recovery=null;await poll();assert.equal(warning.textContent,'');
  }finally{delete globalThis.document;delete globalThis.fetch;delete globalThis.setInterval;}
});

test('archival uses explicit run-bound page confirmation, supports cancel/localization and fences duplicate or stale confirmation',async()=>{
  const document=new Document();globalThis.document=document;
  for(const [id,value] of [['language','en'],['student','bruno']])document.add(id,value);
  for(const id of ['mode','start','retire','refresh','send','chat-title','calendar-title','proposal-title','approval-note','run','run-warning','notice','messages','question','calendar','proposal','chat','text','retire-confirm'])document.add(id);
  let current={id:'archive-run-1',student:'bruno',phase:'active'},poll,nativePrompts=0,retireCalls=0,selectedRun,finish=deferred();
  globalThis.confirm=()=>{nativePrompts++;throw Error('Native browser confirmation is unavailable');};
  globalThis.setInterval=callback=>{poll=callback;return 1;};
  globalThis.fetch=async(url,options={})=>{
    const route=new URL(url,'http://localhost').pathname;
    if(route==='/api/run')return response({run:current,available:!!current});
    if(route==='/api/status')return response({state:{plan:null},recovery:null,calendar:{availability:'available'},events:[]});
    if(route==='/api/chat/state')return response({busy:false,messages:[],question:null});
    if(route==='/api/run/retire'){retireCalls++;selectedRun=JSON.parse(options.body).runId;await finish.promise;current=null;return response({archiveId:selectedRun});}
    throw Error('Unexpected route '+route);
  };
  const panel=document.getElementById('retire-confirm'),buttons=()=>descendants(panel,n=>n.tagName==='BUTTON');
  try{
    await import(`../public/managed.js?archive-test=${Date.now()}`);
    await document.getElementById('retire').onclick();assert.equal(nativePrompts,0);assert.match(panel.textContent,/archive-run-1/);assert.equal(retireCalls,0);
    buttons().find(b=>b.textContent==='Keep run open').onclick();assert.equal(panel.children.length,0);assert.equal(retireCalls,0);
    document.getElementById('retire').onclick();const stale=buttons().find(b=>b.textContent==='Confirm end and archive');
    current={id:'archive-run-2',student:'bruno',phase:'active'};await poll();await stale.onclick();assert.equal(retireCalls,0,'old confirmation cannot retire a new run');
    document.getElementById('retire').onclick();document.getElementById('language').value='pt';await poll();
    const confirmButton=buttons().find(b=>b.textContent==='Confirmar encerramento e arquivar');assert(confirmButton);assert.match(panel.textContent,/archive-run-2/);
    const pending=confirmButton.onclick();assert.equal(retireCalls,1);assert(buttons().every(b=>b.disabled));await confirmButton.onclick();assert.equal(retireCalls,1);
    finish.resolve();await pending;assert.equal(selectedRun,'archive-run-2');assert.equal(panel.children.length,0);assert.match(document.getElementById('notice').textContent,/Execução arquivada/);assert.equal(nativePrompts,0);
  }finally{delete globalThis.document;delete globalThis.fetch;delete globalThis.setInterval;delete globalThis.confirm;}
});

test('an unconfirmed approval stays disabled after failed readback and a pending poll',async()=>{
  const document=new Document();
  for(const [id,value] of [['language','en'],['student','bruno']])document.add(id,value);
  for(const id of ['mode','start','retire','refresh','send','chat-title','calendar-title','proposal-title','approval-note','run','run-warning','notice','messages','question','calendar','proposal','chat','text'])document.add(id);
  globalThis.document=document;
  let poll,approvalCalls=0,readUnavailable=false,planId='plan-before-timeout';
  globalThis.setInterval=callback=>{poll=callback;return 1;};
  globalThis.fetch=async url=>{
    switch(new URL(url,'http://localhost').pathname){
      case '/api/run':
        return response({run:{id:'run-1',student:'bruno',phase:'active'},available:true});
      case '/api/chat/state':
        return response({busy:false,messages:[]});
      case '/api/status':
        if(readUnavailable)throw Error('Readback unavailable');
        return response({
          state:{plan:{id:planId,status:{near:'pending'},near:[{id:'study',summary:'Study'}]}},
          calendar:{availability:'available'},events:[]
        });
      case '/api/approve':
        approvalCalls++;
        readUnavailable=true;
        return {...response({error:'Could not confirm the controller response',outcome:'unconfirmed'},false),status:502};
      default:
        throw Error(`Unexpected route ${url}`);
    }
  };
  try {
    await import(`../public/managed.js?unknown-approval-test=${Date.now()}`);
    const proposals=document.getElementById('proposal');
    const near=()=>buttonWithLabel(proposals,'Approve coming week');
    await near().onclick();
    assert.equal(approvalCalls,1);
    assert.match(document.getElementById('notice').textContent,/Could not confirm|could not be confirmed/i);
    assert.equal(near().disabled,true);
    await near().onclick();
    assert.equal(approvalCalls,1,'the cached pending proposal cannot trigger a retry');
    readUnavailable=false;
    await poll();
    assert.equal(near().disabled,true,'a pending snapshot does not establish the write failed');
    planId='fresh-proposal';
    await poll();
    assert.equal(near().disabled,false,'the newly reviewed proposal is eligible');
  } finally {
    delete globalThis.document;delete globalThis.fetch;delete globalThis.setInterval;
  }
});
