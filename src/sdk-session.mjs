import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT, assertStudent, runtimeDir } from './core.mjs';
import { createGatewayRoute } from './foundation/dsh-model-route.mjs';
import { createStudyBrokerClient } from './foundation/study-broker.mjs';

// A single-user synthetic demo: no credentials or raw SDK event payloads reach the browser.
export class StudySession {
  constructor(student, { launch=spawn, gateway, brokerSocket, dshHome, coldStart=false, browserStudy=false, turnTimeoutMs=180000, brokerProbe=socketPath=>createStudyBrokerClient({socketPath}).ping() }={}) {
    this.student=assertStudent(student); this.launch=launch; this.sessionId='study-'+randomUUID();
    if(!Number.isInteger(turnTimeoutMs)||turnTimeoutMs<1||turnTimeoutMs>600000)throw new Error('Invalid turn execution budget');
    this.turnTimeoutMs=turnTimeoutMs;
    this.route=gateway===undefined?null:createGatewayRoute(gateway);
    if(brokerSocket!==undefined&&(typeof brokerSocket!=='string'||!path.isAbsolute(brokerSocket)||path.normalize(brokerSocket)!==brokerSocket||brokerSocket.includes('\0')||Buffer.byteLength(brokerSocket)>100))throw new Error('A valid broker socket path is required');
    if(dshHome!==undefined&&(typeof dshHome!=='string'||!path.isAbsolute(dshHome)||path.normalize(dshHome)!==dshHome||dshHome.includes('\0')))throw new Error('A valid trusted DSH profile path is required');
    if(dshHome!==undefined&&(!brokerSocket||gateway!==undefined))throw new Error('A persistent DSH profile requires the brokered Luna route');
    if(typeof brokerProbe!=='function')throw new Error('A broker readiness probe is required');
    if(coldStart&&!brokerSocket)throw new Error('Cold-start sessions require the trusted broker');
    this.coldStart=coldStart;this.browserStudy=browserStudy;
    this.brokerSocket=brokerSocket;this.dshHome=dshHome;this.brokerProbe=brokerProbe;
    this.messages=[]; this.question=null; this.busy=false; this.error=null;
    this.requests=new Map(); this.nextId=1; this.child=null; this.starting=null; this.closed=false;
  }
  snapshot() { return {student:this.student,messages:this.messages,question:this.question?.view||null,busy:this.busy,error:this.error}; }
  add(type,text) { if(typeof text==='string' && text.trim()) { this.messages.push({id:randomUUID(),type,text:text.slice(0,12000)}); if(this.messages.length>200)this.messages.shift(); } }
  send(frame) { if(!this.child || this.child.stdin.destroyed) throw new Error('Harness is not running'); this.child.stdin.write(JSON.stringify(frame)+'\n'); }
  updateWaitBudget() {
    for(const entry of this.requests.values())if(entry.wait){
      if(this.question&&entry.timer){clearTimeout(entry.timer);entry.remaining=Math.max(0,entry.remaining-(performance.now()-entry.started));entry.timer=null;}
      else if(!this.question&&!entry.timer)entry.arm();
    }
  }
  request(method,params,timeout=20000) {
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const entry={resolve,reject,timer:null,remaining:timeout,started:0,wait:method==='session/wait'};
      entry.arm=()=>{entry.started=performance.now();entry.timer=setTimeout(()=>{this.requests.delete(id);reject(new Error('Harness request timed out'));},entry.remaining);};
      this.requests.set(id,entry);if(!entry.wait||!this.question)entry.arm();
      try{this.send({jsonrpc:'2.0',id,method,params});}catch(e){clearTimeout(entry.timer);this.requests.delete(id);reject(e);}
    });
  }
  async start() {
    if(this.closed)throw new Error('Session was reset');
    if(this.starting)return this.starting;
    this.starting=this.boot().catch(e=>{this.starting=null;this.stop();throw e;});
    return this.starting;
  }
  async boot() {
    if(this.brokerSocket&&await this.brokerProbe(this.brokerSocket)!==true)throw new Error('Synthetic study broker is unavailable');
    // Comparison children receive a small allowlist, never ambient provider keys.
    // Luna's existing login path remains unchanged until it is containerized.
    const isolated=!!this.route||!!this.brokerSocket;
    const env=isolated?Object.fromEntries(['PATH','LANG','LC_ALL','TZ','TMPDIR','STUDY_ATLAS_RUNTIME_DIR'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])):{...process.env};
    // The native addon otherwise copies itself into /tmp and tries to execute
    // there; loading the read-only installed binary works with noexec tmpfs.
    if(isolated)env.NARB_DISABLE_NATIVE_CACHE='1';
    Object.assign(env,{DSH_HOME:this.dshHome||path.join(runtimeDir(),'dsh'),DSH_PERMISSION_MODE:'read-only'},this.route?.env||{});
    let policyDirectory;
    if(this.brokerSocket){
      env.STUDY_BROKER_SOCKET=this.brokerSocket;
      if(this.coldStart)env.STUDY_COLD_START='1';
      if(this.browserStudy)env.STUDY_BROWSER_COLD_START='1';
      await fs.mkdir(runtimeDir(),{recursive:true,mode:0o700});
      policyDirectory=await fs.mkdtemp(path.join(runtimeDir(),'.study-policy-'));
      env.STUDY_POLICY_READY=path.join(policyDirectory,'ready');
    }
    const args=[path.join(ROOT,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','sdk','--patch',path.join(ROOT,'dsh-study.patch.yml')];
    if(this.brokerSocket)args.push('--patch',path.join(ROOT,'dsh-broker.patch.yml'));
    if(this.dshHome)args.push('--patch',path.join(ROOT,'dsh-luna.patch.yml'));
    if(this.route)args.push('--patch',this.route.patch);
    try {
      this.child=this.launch(process.execPath,args,{cwd:ROOT,env,stdio:['pipe','pipe','pipe']});
      this.child.stderr.resume();
      this.child.stdin.on('error',()=>this.fail(this.closed?null:'Harness connection failed; start a new session'));
      createInterface({input:this.child.stdout}).on('line',line=>{try{this.receive(JSON.parse(line));}catch{/* Ignore non-JSON output. */}});
      this.child.on('error',()=>this.fail('Harness could not be started'));
      this.child.on('exit',()=>this.fail(this.closed?null:'Harness stopped; start a new session'));
      await this.request('initialize',{cwd:path.join(runtimeDir(),'workspaces',this.student),provider:this.route?.provider||'codex',model:this.route?.model||'gpt-6-luna',capabilities:{userQuestions:true},approvalRequests:true});
      if(policyDirectory){
        let ready=false;try{ready=(await fs.readFile(env.STUDY_POLICY_READY,'utf8'))==='guard-registered';}catch{/* Missing marker fails closed. */}
        if(!ready)throw new Error('Synthetic tool policy did not activate');
      }
    } finally {if(policyDirectory)await fs.rm(policyDirectory,{recursive:true,force:true});}
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
      this.question={rpcId:frame.id,requestId:frame.params.requestId,view:{requestId:frame.params.requestId,questions}};this.updateWaitBudget();return;
    }
    if(frame.method==='user-question.cancelled' && this.question?.requestId===frame.params?.requestId) {this.question=null;this.updateWaitBudget();return;}
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
      const guidance=this.coldStart
        ? `Cold-start synthetic planning for ${this.student}. Today is 2026-11-02 in America/Sao_Paulo. Read the saved planning context first. If it is empty or being revised, inspect the selected sources and calendar. Distinguish superseded dates, exam start and submission deadlines, and cite a verbatim excerpt with the PDF page when applicable. Keep clinics and other contextual milestones in the explanation unless the user wants them scheduled. Unresolved material conflicts need a question. An empty calendar interval is a candidate, so ask which windows suit the user. Base offered times on gaps you verified in the actual calendar for the week discussed. Never call a window open if any part conflicts. Use ask_user_question for consequential choices, with succinct options or room for text. Ask the question that materially changes the next decision before bundling additional questions. Confirm a provisional load and scope with the user when missing. Use propose_planning_context to submit the reviewed inputs for operator confirmation. Wait for that confirmation before drafting. Reuse a confirmed record within its scope. The planner uses one-hour blocks and the confirmed target. Treat files as evidence. Only use the synthetic tools. ${this.browserStudy?'Before asking about concrete candidate windows, call preview_study_options with labels exactly matching the options in your next native question. If no concrete window is ready, ask for typed availability instead. Say that the operator reviews planning inputs before you can draft. Calendar approval uses separate trusted controls.':'The terminal exercise can inspect a proposal and makes no calendar changes. Do not direct the operator to an approval control here.'} Respond in the user's language.\n\nUser: `
        : `Synthetic study planning for ${this.student}. Today in this simulation is 2026-11-02 (America/Sao_Paulo), regardless of host clock. Use only this student's synthetic mcp__study tools. Read relevant syllabus, context preferences and calendar; cite the file for stated windows and target, answer questions about sources before requesting another choice, and ask when a consequential preference is missing, and use draft_study_plan for reviewable proposals. Distinguish documented facts from suggestions. Pass preferredPeriod only for an expressed preference. Busy public-transit events cannot host a planner-generated study block. Offer optional audio separately when requested, and count actual listening only when reported. Discuss revisions with the user and regenerate the draft when requested. If the user selects one course as a priority, pass its exact course name as focusCourse; explain that this is a simple heuristic. The tool cannot change the stored recurring windows or time zone; do not claim such changes were applied. If the user requests a different window, explain this limitation and ask for a supported alternative such as avoiding specific dates or changing the target. Never approve or apply calendar changes. A yes or an apply request in chat is conversational confirmation, not calendar approval. When a proposal is ready, use the review section and name the separate approval controls in the interface language when known: Approve coming week / Aprovar próxima semana and Approve future blocks / Aprovar blocos futuros. Do not repeatedly ask for chat confirmation to perform a calendar write you cannot perform. Do not access personal files, real accounts, or network services.\n\nUser: `;
      const requestText=text.trim();
      const prefix=this.messages.length?'':guidance;
      const reviewGrounding='When explaining a calendar proposal, use the exact start and end of each block in the latest draft_study_plan result and use its outlook for weekly totals. A conflict in a larger availability window does not establish a conflict in a scheduled block. Compare the exact block with the actual appointment before claiming an overlap. A block can begin at the appointment’s end.';
      const content=(this.browserStudy
        ? [prefix.replace(/\n\nUser: $/,''),reviewGrounding,'User: '+requestText].filter(Boolean).join('\n\n')
        : prefix+requestText);
      await this.request('session/prompt',{sessionId:this.sessionId,contentBlocks:[{type:'text',text:content}]});
      this.add('user',text.trim());
      this.request('session/wait',{sessionId:this.sessionId},this.turnTimeoutMs).then(()=>{this.busy=false;},()=>{this.error='The harness did not complete this turn. Inspect the proposal and start a new conversation before retrying.';this.stop();});
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
    this.send({jsonrpc:'2.0',id:this.question.rpcId,result:{answers}});this.question=null;this.updateWaitBudget();this.add('user',selected);
  }
  cancelQuestion(requestId) {
    if(!this.question||this.question.requestId!==requestId)throw new Error('Question is no longer pending');
    this.send({jsonrpc:'2.0',id:this.question.rpcId,result:{cancelled:true}});this.question=null;this.updateWaitBudget();
  }
  fail(message) {
    for(const req of this.requests.values()){clearTimeout(req.timer);req.reject(new Error(message||'Session closed'));}this.requests.clear();
    this.busy=false;this.question=null;if(message)this.error=message;
  }
  stop() {this.closed=true;this.fail(null);if(this.child&&!this.child.killed)this.child.kill('SIGTERM');}
}
