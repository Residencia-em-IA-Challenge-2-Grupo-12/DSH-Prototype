import {access,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

if(process.getuid()===0)throw new Error('Synthetic agent must run as non-root');
const mounts=await readFile('/proc/self/mountinfo','utf8');
const tmpMount=mounts.split('\n').find(line=>line.split(' ')[4]==='/tmp');
if(!tmpMount||!tmpMount.split(' ')[5].split(',').includes('noexec'))throw new Error('Synthetic agent temporary storage must be noexec');
for(const forbidden of ['/var/run/docker.sock','/app/.env','/run/secrets/openrouter_env']){
  try {await access(forbidden);throw new Error('Unexpected protected mount');}catch(error){if(error.message==='Unexpected protected mount')throw error;}
}
let reachable=false;
for(let n=0;n<50;n++){try{await fetch('http://model-gateway:8090/');reachable=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
if(!reachable)throw new Error('Synthetic gateway did not start');

const child=spawn(process.execPath,['/app/src/agent-stdio.mjs'],{cwd:'/app',env:process.env,stdio:['pipe','pipe','pipe']});
let diagnostic='',nextId=1;const pending=new Map();
child.stderr.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-3000);});
createInterface({input:child.stdout}).on('line',line=>{let frame;try{frame=JSON.parse(line);}catch{return;}
  if(pending.has(frame.id)){pending.get(frame.id)(frame);pending.delete(frame.id);}
});
const request=(op,data={})=>new Promise((resolve,reject)=>{
  const id=nextId++,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Synthetic agent control timed out'));},15000);
  pending.set(id,frame=>{clearTimeout(timer);resolve(frame);});child.stdin.write(JSON.stringify({id,op,...data})+'\n');
});
try {
  const forbidden=await request('approve',{planId:'synthetic'});
  if(!/not available/i.test(forbidden.error||''))throw new Error('Agent control exposed calendar approval');
  const started=await request('prompt',{text:'Inspect and draft for the synthetic student.'});
  if(started.error)throw new Error(started.error);
  let snapshot=started.result;const deadline=Date.now()+15000;
  while(snapshot.busy&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,50));const response=await request('snapshot');if(response.error)throw new Error(response.error);snapshot=response.result;}
  if(snapshot.busy||snapshot.error||!snapshot.messages.some(message=>message.text.includes('Synthetic container response.')))throw new Error('DSH container did not complete the synthetic gateway call');
  console.log('Synthetic DSH container completed through the isolated gateway.');
} catch(error){throw new Error(`${error.message}; synthetic agent diagnostic: ${diagnostic}`);
} finally {
  if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();await exited;}
}
