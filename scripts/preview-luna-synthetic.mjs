import {spawn} from 'node:child_process';
import {mkdtemp,realpath,rmdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {coldStartStudents} from '../src/cold-start-context.mjs';
import {ROOT} from '../src/core.mjs';
import {createExclusiveRunManager} from '../src/foundation/exclusive-run-manager.mjs';
import {createHostLunaDriver} from '../src/foundation/host-luna-driver.mjs';
import {createManagedStudyApi} from '../src/foundation/managed-study-api.mjs';
import {startControllerRpc} from '../src/foundation/controller-rpc.mjs';

const root=process.env.STUDY_RUN_ROOT||path.join(tmpdir(),`study-luna-${process.getuid?.()??'local'}`);
const profile=process.env.STUDY_LUNA_DSH_HOME,port=Number(process.env.PORT||4176);
if(Buffer.byteLength(path.join(root,'runs','00000000-0000-4000-8000-000000000000','ipc/agent.sock'))>100)throw Error('Choose a shorter STUDY_RUN_ROOT for Unix socket limits');
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local port');
const coldStart=process.env.STUDY_COLD_CASE;
if(coldStart!==undefined&&!Object.hasOwn(coldStartStudents,coldStart))throw Error('Unknown STUDY_COLD_CASE');
if(!path.isAbsolute(profile||''))throw Error('Set STUDY_LUNA_DSH_HOME to an absolute existing profile directory');
const dshHome=await realpath(profile).catch(()=>null);
const profileInfo=dshHome&&await stat(dshHome).catch(()=>null);
if(!profileInfo?.isDirectory())throw Error('STUDY_LUNA_DSH_HOME does not resolve to an accessible profile directory');
const student=coldStart?coldStartStudents[coldStart]:'bruno';
let driver,web,rpc,ipc;
const manager=await createExclusiveRunManager({root,driverFactory:({lease})=>{
  driver=createHostLunaDriver({root,lease,dshHome,coldStart});return driver;
}});
try{
  // An old web process must never reconnect to a replacement controller.
  // The lease and run registry still use the original persistent root.
  ipc=await mkdtemp(path.join(root,'control-'));
  const socketPath=path.join(ipc,'controller.sock');
  const operations=createManagedStudyApi({manager,driver});
  const api={...operations,
    async runStatus(){return {...await operations.runStatus(),runtime:'host-luna-fallback',...(coldStart?{caseId:coldStart,student}:{} )};},
    async start(selected){if(selected!==student)throw Error('The selected student does not match this browser exercise');return operations.start(student);}
  };
  rpc=await startControllerRpc({socketPath,api});
  const env=Object.fromEntries(['PATH','LANG','LC_ALL','TZ'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  web=spawn(process.execPath,[path.join(ROOT,'src/managed-server.mjs')],{env:{...env,STUDY_CONTROLLER_SOCKET:socketPath,PORT:String(port)},stdio:['ignore','ignore','inherit']});
  web.once('error',()=>{process.exitCode=1;});
  process.stdout.write(`HOST LUNA SYNTHETIC FALLBACK http://127.0.0.1:${port}/\nState/evidence: ${root}\nDSH/controller are on the host; only Calendarpit is containerized. No LAN/Tailscale control.\n`);
  let stopping=false;
  async function stop(){
    if(stopping)return;stopping=true;web.kill('SIGTERM');
    try{const run=await manager.current();if(run)await manager.retire({expectedRunId:run.id});}
    catch{process.stderr.write('Retirement blocked: preserve the recorded run and resources for facilitator inspection.\n');process.exitCode=1;}
    try{await rpc.close();await rmdir(ipc);await manager.close();}catch{process.exitCode=1;}
  }
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop());
}catch(error){web?.kill('SIGTERM');await rpc?.close();if(ipc)await rmdir(ipc);await manager.close();throw error;}
