import {access,mkdir,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {StudySession} from '/app/src/sdk-session.mjs';

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
await mkdir('/tmp/study-runtime/workspaces/ana',{recursive:true});
let diagnostic='';
const session=new StudySession('ana',{gateway:{baseURL:'http://model-gateway:8090/v1',accessToken:'a'.repeat(64)},
  launch:(...args)=>{const child=spawn(...args);child.stderr.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-4000);});return child;}});
try {
  await session.prompt('This is a synthetic container test.');
  const deadline=Date.now()+15000;
  while(session.snapshot().busy&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  if(session.snapshot().busy||session.snapshot().error||!session.snapshot().messages.some(m=>m.text.includes('Synthetic container response.')))throw new Error('DSH container did not complete the synthetic gateway call');
  console.log('Synthetic DSH container completed through the isolated gateway.');
} catch(error){throw new Error(`${error.message}; synthetic harness diagnostic: ${diagnostic}`);
} finally {
  if(session.child&&session.child.exitCode===null){const exited=new Promise(resolve=>session.child.once('exit',resolve));session.stop();await exited;}
  else session.stop();
}
