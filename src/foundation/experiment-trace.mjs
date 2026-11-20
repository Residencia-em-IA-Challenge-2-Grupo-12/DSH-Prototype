import {constants,promises as fs} from 'node:fs';
import path from 'node:path';

const kinds=new Set(['message','question','tool','proposal','decision','write','observation','failure','usage','configuration']);
const sensitive=/(?:authorization|cookie|password|secret|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|environment)/i;
const id=/^[A-Za-z0-9_-]{1,128}$/;
function project(value,depth=0){
  if(depth>20)throw new Error('Trace value is too deeply nested');
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return value.replace(/\bBearer\s+[^\s"']+/gi,'Bearer [REDACTED]').replace(/\bsk-[A-Za-z0-9_-]{12,}/g,'[REDACTED]');
  if(Array.isArray(value))return value.map(item=>project(item,depth+1));
  if(!value||typeof value!=='object')throw new Error('Unsupported trace value');
  return Object.fromEntries(Object.entries(value).filter(([key])=>!sensitive.test(key)).map(([key,item])=>[key,project(item,depth+1)]));
}

// Synthetic-only local evidence. Redaction is defense in depth, not permission
// to supply credentials, real personal data, raw HTTP headers or environment.
export async function createExperimentTrace({directory,runId,attemptId}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||!id.test(runId||'')||!id.test(attemptId||''))throw new Error('Invalid synthetic trace identity');
  const info=await fs.lstat(directory);
  if(!info.isDirectory()||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))throw new Error('Trace directory must be private');
  const handle=await fs.open(path.join(directory,'trace.jsonl'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await handle.close();let sequence=0,queue=Promise.resolve(),healthy=true;
  return {append(kind,data){
    if(!kinds.has(kind))return Promise.reject(new Error('Invalid trace event type'));
    let projected;try{projected=project(data);}catch(error){return Promise.reject(error);}
    queue=queue.then(async()=>{
      const row={version:1,runId,attemptId,sequence:++sequence,recordedAt:new Date().toISOString(),kind,data:projected};
      const line=JSON.stringify(row)+'\n';if(Buffer.byteLength(line)>1_000_000)throw new Error('Trace event too large');
      const output=await fs.open(path.join(directory,'trace.jsonl'),constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);
      try{await output.writeFile(line);await output.sync();}finally{await output.close();}
      return row.sequence;
    }).catch(error=>{healthy=false;throw error;});return queue;
  },healthy:()=>healthy};
}
