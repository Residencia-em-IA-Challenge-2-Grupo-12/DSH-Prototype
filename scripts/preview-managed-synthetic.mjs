import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT} from '../src/core.mjs';
import {createControllerClient} from '../src/foundation/controller-rpc.mjs';
const exec=promisify(execFile),docker=async(...args)=>(await exec('docker',args,{timeout:30000,maxBuffer:64000})).stdout.trim();
const root=await mkdtemp(path.join(tmpdir(),'study-ui-')),id=randomUUID(),gatewayName='study-ui-gateway-'+id,network='study-ui-net-'+id;
const tokenFile=path.join(root,'gateway-token');await writeFile(tokenFile,'a'.repeat(64)+'\n',{mode:0o600});
const socketPath=path.join(root,'control/controller.sock');let controller,web,gateway,closing=false;
const env=Object.fromEntries(['PATH','LANG','LC_ALL','TZ'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
async function stop(){if(closing)return;closing=true;let retired=false;
  try{const client=createControllerClient({socketPath}),status=await client.runStatus();if(status.run)await client.retire(status.run.id);retired=true;}catch{process.stderr.write('Retirement unavailable; preserve synthetic evidence and inspect labelled resources.\n');}
  web?.kill('SIGTERM');controller?.kill('SIGTERM');
  if(retired){if(gateway)await docker('rm','-f',gatewayName);await docker('network','rm',network);}
  process.stdout.write('Synthetic evidence retained at '+root+'\n');
}
try{
  const image=await docker('image','inspect','--format','{{.Id}}','study-dsh-agent:synthetic');
  await docker('network','create','--internal',network);
  gateway=await docker('run','-d','--rm','--name',gatewayName,'--label','study.role=model-gateway','--network',network,'--user','node','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,nodev',
    '--mount',`type=bind,source=${path.join(ROOT,'src')},target=/app/src,readonly`,'--mount',`type=bind,source=${path.join(ROOT,'tests/fixtures/collaborative-gateway.mjs')},target=/app/fake-gateway.mjs,readonly`,
    'node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57','node','/app/fake-gateway.mjs');
  controller=spawn(process.execPath,[path.join(ROOT,'src/managed-controller.mjs')],{env:{...env,STUDY_RUN_ROOT:root,STUDY_AGENT_IMAGE:image,STUDY_GATEWAY_CONTAINER_ID:gateway,STUDY_GATEWAY_TOKEN_FILE:tokenFile},stdio:['ignore','ignore','inherit']});
  const deadline=Date.now()+15000;while(true){try{await createControllerClient({socketPath}).runStatus();break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(r=>setTimeout(r,100));}}
  web=spawn(process.execPath,[path.join(ROOT,'src/managed-server.mjs')],{env:{...env,STUDY_CONTROLLER_SOCKET:socketPath,PORT:process.env.PORT||'4176'},stdio:['ignore','ignore','inherit']});
  process.stdout.write('SCRIPTED SYNTHETIC PREVIEW http://127.0.0.1:'+(process.env.PORT||'4176')+'/\nEvidence: '+root+'\n');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop().catch(()=>{process.exitCode=1;}));
}catch(error){await stop();throw error;}
