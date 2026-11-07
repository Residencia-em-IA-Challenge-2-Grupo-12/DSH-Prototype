import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
import {createDomainService} from '../../src/domain-service.mjs';
import {stopChild} from './process-cleanup.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
await access(path.join(here,'client.js'));
const tmp=await mkdtemp(path.join(tmpdir(),'dsh-browser-proof-'));
const service=createDomainService();let child, failure;
try{
 const patch=path.join(tmp,'patch.yml');
 await writeFile(patch,'- insert:\n    - id: study-calendar-browser-spike\n      name: '+JSON.stringify(path.join(here,'index.mjs'))+'\n      inject: [typert]\n',{mode:0o600});
 const {port}=await service.listen(0);const origin=`http://127.0.0.1:${port}`,prefix='/v1/students/ana';
 const post=async(p,body)=>{let r=await fetch(origin+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(r.status!==201)throw Error('Synthetic setup failed: '+r.status);return r.json()};
 const event={id:'demo-class',summary:'Synthetic class',start:{dateTime:'2026-11-02T09:00:00-03:00'},end:{dateTime:'2026-11-02T11:00:00-03:00'}};
 for(const kind of ['context','evidence','calendar'])await post(prefix+'/revisions/'+kind,{expectedVersion:0,payload:kind==='calendar'?{events:[event]}:{synthetic:true}});
 const proposal=await post(prefix+'/proposals',{versions:{context:1,evidence:1,calendar:1},payload:{sections:{near:{action:{type:'create',calendarId:'ana-calendar',event:{id:'demo-study',summary:'Synthetic study',start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}}}}},sources:['course.md'],assumptions:[]}});
 child=spawn(repo+'/node_modules/.bin/node',[repo+'/node_modules/@deepseek-ai/dsh/lib/bin.js','--profile','web','--patch',patch,'--host','127.0.0.1','--port','0','--no-open'],{cwd:repo,env:{PATH:process.env.PATH,HOME:tmp,DSH_HOME:tmp+'/dsh',STUDY_PANEL_ORIGIN:origin,STUDY_PANEL_PROPOSAL:proposal.id},stdio:['ignore','pipe','pipe']});
 let pending='',target;
 const found=new Promise((resolve,reject)=>{let timer=setTimeout(()=>reject(Error('DSH web startup timed out')),25000);child.stdout.on('data',b=>{pending+=b.toString();const m=pending.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);if(m){clearTimeout(timer);target=m[1];resolve()}});child.on('exit',()=>{clearTimeout(timer);reject(Error('DSH web exited before readiness'))});child.on('error',reject);child.stderr.resume();});
 await found;
 let login=await fetch(target,{redirect:'manual'});assert.equal(login.status,303);let cookie=login.headers.get('set-cookie')?.split(';')[0];assert(cookie,'synthetic browser session cookie absent');
 let base=new URL(target).origin;let page=await fetch(base+'/',{headers:{cookie}});assert.equal(page.status,200);let html=await page.text();
 console.log('authenticated index',page.status,'plugin boot row',html.includes('study-calendar-browser-spike'));
 const links=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&'));
 const bundle=links.find(link=>link.includes('study-calendar-browser-spike/client.js'));assert(bundle,'native client bundle reference missing');
 const asset=await fetch(new URL(bundle,base+'/'));assert.equal(asset.status,200);const source=await asset.text();assert(source.includes('study-calendar-browser-spike'));assert(source.includes('Read-only preview'));console.log('DSH client bundle served',asset.status);
 let envelope={type:'client-request',rpcId:randomUUID(),method:'calendarSpike/view',payload:{args:{}}};
 let rpc=await fetch(base+'/api/calendarSpike/view',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(envelope)});const reply=await rpc.json();
 console.log('authenticated RPC',rpc.status,reply.result?.ok?'ok':'failed');
 const inherited={type:'client-request',rpcId:randomUUID(),method:'calendarSpike/read',payload:{args:{student:'ana',proposalId:proposal.id}}};
 const extra=await fetch(base+'/api/calendarSpike/read',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(inherited)});assert.equal(extra.status,404);console.log('unexported read route denied',extra.status);
 const forged={type:'client-request',rpcId:randomUUID(),method:'calendarSpike/approve',payload:{args:{}}};
 const write=await fetch(base+'/api/calendarSpike/approve',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(forged)});assert.equal(write.status,404);console.log('unexported approval route denied',write.status);
 assert.equal(reply.result.ok,true,JSON.stringify(reply.result));assert.equal(reply.result.value.calendar.events[0].summary,'Synthetic class');assert.equal(reply.result.value.proposal.payload.sections.near.action.event.summary,'Synthetic study');assert.equal(reply.result.value.stale,false);
 await post(prefix+'/revisions/context',{expectedVersion:1,payload:{synthetic:true,changed:true}});
 let staleReply=await fetch(base+'/api/calendarSpike/view',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(envelope)});assert.equal((await staleReply.json()).result.value.stale,true);console.log('stale proposal surfaced');
 let unauth=await fetch(base+'/api/calendarSpike/view',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)});assert.equal(unauth.status,401);console.log('unauthenticated RPC denied',unauth.status);
 // Verify the DSH served client package graph and bundle, without printing session credentials.

} catch(error) { failure=error; } finally {
 const cleanup=[];let stopped=false;
 try {await stopChild(child);stopped=true;} catch(error) {cleanup.push(error);}
 try {await service.close();} catch(error) {cleanup.push(error);}
 if(stopped)try {await rm(tmp,{recursive:true,force:true});} catch(error) {cleanup.push(error);}
 if(cleanup.length)throw new AggregateError(failure?[failure,...cleanup]:cleanup,`DSH cleanup failed; temporary state may remain at ${tmp}`);
}
if(failure)throw failure;
