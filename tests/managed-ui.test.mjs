import test from 'node:test';
import assert from 'node:assert/strict';

function setConnected(node,value){node.isConnected=value;for(const child of node.children)setConnected(child,value);}
class Element {
  constructor(tag,ownerDocument){this.tagName=tag.toUpperCase();this.ownerDocument=ownerDocument;this.children=[];this.parentNode=null;this._text='';this.value='';this.disabled=false;this.required=false;this.isConnected=false;this.dataset={};this.style={};this.scrollTop=0;this.scrollLeft=0;this.clientHeight=100;this.scrollHeight=100;}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const child of nodes){if(child.parentNode)child.parentNode.removeChild(child);child.parentNode=this;setConnected(child,this.isConnected);this.children.push(child);}}
  appendChild(node){this.append(node);return node;}
  removeChild(node){const index=this.children.indexOf(node);if(index>=0){this.children.splice(index,1);node.parentNode=null;setConnected(node,false);}return node;}
  replaceChildren(...nodes){for(const child of this.children){child.parentNode=null;child.isConnected=false;}this.children=[];this._text='';this.append(...nodes);}
  setAttribute(){}
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
    const messageNode=messages.children[0],questionInput=question.children[0].children.find(child=>child.tagName==='TEXTAREA');
    questionInput.value='keep my draft';

    await poll();
    assert.equal(buttonWithLabel(proposals,'Approve coming week'),near,'unchanged polling must preserve the approval button node');
    assert.equal(messages.children[0],messageNode,'unchanged polling must preserve message nodes and scroll position');
    assert.equal(question.children[0].children.find(child=>child.tagName==='TEXTAREA'),questionInput,'unchanged polling must preserve form inputs');
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
