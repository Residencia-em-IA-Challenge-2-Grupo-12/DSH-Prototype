import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { ROOT, assertStudent } from './core.mjs';

// A single-user synthetic demo: no credentials or raw SDK event payloads reach the browser.
export class StudySession {
  constructor(student, { launch=spawn }={}) {
    this.student=assertStudent(student); this.launch=launch; this.sessionId='study-'+randomUUID();
    this.messages=[]; this.question=null; this.busy=false; this.error=null;
    this.requests=new Map(); this.nextId=1; this.child=null; this.starting=null; this.closed=false;
  }
  snapshot() { return {student:this.student,messages:this.messages,question:this.question?.view||null,busy:this.busy,error:this.error}; }
  add(type,text) { if(typeof text==='string' && text.trim()) { this.messages.push({id:randomUUID(),type,text:text.slice(0,12000)}); if(this.messages.length>200)this.messages.shift(); } }
  send(frame) { if(!this.child || this.child.stdin.destroyed) throw new Error('Harness is not running'); this.child.stdin.write(JSON.stringify(frame)+'\n'); }
  request(method,params,timeout=20000) {
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.requests.delete(id);reject(new Error('Harness request timed out'));},timeout);
      this.requests.set(id,{resolve,reject,timer});
      try{this.send({jsonrpc:'2.0',id,method,params});}catch(e){clearTimeout(timer);this.requests.delete(id);reject(e);}
    });
  }
  async start() {
    if(this.closed)throw new Error('Session was reset');
    if(this.starting)return this.starting;
    this.starting=this.boot().catch(e=>{this.starting=null;this.stop();throw e;});
    return this.starting;
  }
  async boot() {
    const env={...process.env,DSH_HOME:path.join(ROOT,'.runtime/dsh'),DSH_PERMISSION_MODE:'read-only'};
    this.child=this.launch(path.join(ROOT,'node_modules/.bin/node'),[path.join(ROOT,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','sdk','--patch',path.join(ROOT,'dsh-study.patch.yml')],{cwd:ROOT,env,stdio:['pipe','pipe','pipe']});
    this.child.stderr.resume();
    this.child.stdin.on('error',()=>this.fail(this.closed?null:'Harness connection failed; start a new session'));
    createInterface({input:this.child.stdout}).on('line',line=>{try{this.receive(JSON.parse(line));}catch{/* Ignore non-JSON output. */}});
    this.child.on('error',()=>this.fail('Harness could not be started'));
    this.child.on('exit',()=>this.fail(this.closed?null:'Harness stopped; start a new session'));
    await this.request('initialize',{cwd:path.join(ROOT,'.runtime/workspaces',this.student),provider:'codex',model:'gpt-6-luna',capabilities:{userQuestions:true},approvalRequests:true});
  }
  receive(frame) {
    if(frame.id!==undefined && !frame.method) {
      const pending=this.requests.get(frame.id); if(!pending)return;
      clearTimeout(pending.timer);this.requests.delete(frame.id);
      if(frame.error)pending.reject(new Error('Harness request failed ('+(frame.error.code??'unknown')+')')); else pending.resolve(frame.result);
      return;
    }
    if(frame.method==='approval/request' && frame.id!==undefined) { this.send({jsonrpc:'2.0',id:frame.id,result:{outcome:'rejected'}});this.add('activity','Permission request rejected; calendar changes require the review controls.');return; }
    if(frame.method==='user-question/ask' && frame.id!==undefined) {
      if(this.question) { this.send({jsonrpc:'2.0',id:frame.id,result:{cancelled:true}});return; }
      const questions=Array.isArray(frame.params?.questions)?frame.params.questions:[];
      this.question={rpcId:frame.id,requestId:frame.params.requestId,view:{requestId:frame.params.requestId,questions}};return;
    }
    if(frame.method==='user-question.cancelled' && this.question?.requestId===frame.params?.requestId) {this.question=null;return;}
    if(frame.method!=='session.event' || frame.params?.sessionId!==this.sessionId)return;
    const ev=frame.params.event;
    if(ev?.type==='assistant/message') {
      const content=ev.data?.message?.content;
      if(Array.isArray(content))this.add('assistant',content.filter(x=>x.type==='text').map(x=>x.text).join(''));
    } else if(ev?.type==='tool/call') this.add('activity',ev.data?.name||'Tool');
    else if(ev?.type==='tool/result' && ev.data?.message?.isError) this.add('activity','A tool reported an error; the agent may retry.');
    else if(ev?.type==='turn/end' && ['error','blocked','max-tokens','interrupted'].includes(ev.data?.reason?.kind)) this.error='The agent turn ended: '+ev.data.reason.kind+'. Review its output before retrying.';
  }
  async prompt(text) {
    if(this.closed)throw new Error('Session was reset');
    if(this.busy)throw new Error('The agent is already working');
    if(typeof text!=='string'||!text.trim()||text.length>8000)throw new Error('Enter a message of at most 8000 characters');
    this.busy=true;this.error=null;
    try {
      await this.start();
      const guidance=`Synthetic study planning for ${this.student}. Today in this simulation is 2026-11-02 (America/Sao_Paulo), regardless of host clock. Use only this student's synthetic mcp__study tools. Read relevant syllabus, context preferences and calendar; confirm whether the stated study windows and target still suit the student, ask useful questions when preferences are missing, and use draft_study_plan for reviewable proposals. Explain assumptions and sources. Discuss revisions with the user and regenerate the draft when requested. If the user selects one course as a priority, pass its exact course name as focusCourse; explain that this is a simple heuristic. The tool cannot change the stored recurring windows or time zone; do not claim such changes were applied. If the user requests a different window, explain this limitation and ask for a supported alternative such as avoiding specific dates or changing the target. Never approve or apply calendar changes; the user reviews them in the application. Do not access personal files, real accounts, or network services.\n\nUser: `;
      const content=(this.messages.length?text.trim():guidance+text.trim());
      await this.request('session/prompt',{sessionId:this.sessionId,contentBlocks:[{type:'text',text:content}]});
      this.add('user',text.trim());
      this.request('session/wait',{sessionId:this.sessionId},180000).then(()=>{this.busy=false;},()=>{this.error='The harness did not complete this turn. Inspect the proposal and start a new conversation before retrying.';this.stop();});
    } catch(e) {this.error=e.message+'; inspect the proposal and start a new conversation before retrying.';this.stop();throw e;}
  }
  answer(requestId,answers) {
    if(!this.question || this.question.requestId!==requestId)throw new Error('Question is no longer pending');
    const expected=this.question.view.questions;
    if(!Array.isArray(answers)||answers.length!==expected.length)throw new Error('Answer every question');
    for(const q of expected){
      const answer=answers.find(a=>a.id===q.id);
      if(!answer||!Array.isArray(answer.selected)||answer.selected.some(x=>!q.options?.some(o=>o.label===x))||(!answer.selected.length&&!String(answer.custom||'').trim())||(!q.multiSelect&&answer.selected.length>1)||String(answer.custom||'').length>2000)throw new Error('Invalid answer');
    }
    const selected=answers.map(a=>a.custom||a.selected.join(', ')).join(' · ');
    this.send({jsonrpc:'2.0',id:this.question.rpcId,result:{answers}});this.question=null;this.add('user',selected);
  }
  cancelQuestion(requestId) {
    if(!this.question||this.question.requestId!==requestId)throw new Error('Question is no longer pending');
    this.send({jsonrpc:'2.0',id:this.question.rpcId,result:{cancelled:true}});this.question=null;
  }
  fail(message) {
    for(const req of this.requests.values()){clearTimeout(req.timer);req.reject(new Error(message||'Session closed'));}this.requests.clear();
    this.busy=false;this.question=null;if(message)this.error=message;
  }
  stop() {this.closed=true;this.fail(null);if(this.child&&!this.child.killed)this.child.kill('SIGTERM');}
}
