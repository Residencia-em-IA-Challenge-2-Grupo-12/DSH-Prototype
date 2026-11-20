import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {assertStudent,runtimeDir} from './core.mjs';
import {StudySession} from './sdk-session.mjs';
import {attachAgentControl} from './agent-control.mjs';

// Container-only entry point: configuration comes from the trusted launcher,
// never from a model tool or browser message.
const student=assertStudent(process.env.STUDY_STUDENT);
const route=process.env.STUDY_AGENT_ROUTE||'luna';
if(!['luna','deepseek'].includes(route))throw new Error('Unsupported synthetic agent route');
if(process.env.OPENROUTER_API_KEY)throw new Error('The real provider key must not be in the agent environment');
const brokerSocket='/run/study-broker/agent.sock';
const gateway=route==='deepseek'?{baseURL:'http://model-gateway:8090/v1',
  accessToken:(await readFile('/run/study-control/gateway-token','utf8')).trim()}:undefined;
await mkdir(path.join(runtimeDir(),'workspaces',student),{recursive:true,mode:0o700});
const session=new StudySession(student,{brokerSocket,gateway});
const control=attachAgentControl({session,input:process.stdin,output:process.stdout});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{control.close();process.exit(0);});
