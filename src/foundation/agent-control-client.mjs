import {createInterface} from 'node:readline';

// Trusted-side conversation client. Closing stdin asks the container entry
// point to stop; a lifecycle controller must separately verify its retirement.
export function createAgentControlClient({child,timeoutMs=30000}={}){
  if(!child?.stdin||!child?.stdout||typeof child.on!=='function')throw new Error('An agent control process is required');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new Error('Invalid agent control timeout');
  const pending=new Map(),lines=createInterface({input:child.stdout,crlfDelay:Infinity});let nextId=1,stopped=false;
  const finish=()=>{
    if(stopped)return;stopped=true;
    for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('Agent control stopped; inspect the run before continuing'));}
    pending.clear();
  };
  child.on('error',finish);child.on('exit',finish);child.stdin.on('error',finish);child.stdout.on('error',finish);lines.on('close',finish);
  lines.on('line',line=>{
    let frame;try {if(Buffer.byteLength(line)>2_000_000)throw new Error('Large response');frame=JSON.parse(line);}
    catch{finish();return;}
    if(!Number.isSafeInteger(frame?.id)||frame.id<1||!('result' in frame||typeof frame.error==='string')){finish();return;}
    const entry=pending.get(frame.id);if(!entry)return;
    clearTimeout(entry.timer);pending.delete(frame.id);
    if(typeof frame.error==='string')entry.reject(new Error(frame.error));else entry.resolve(frame.result);
  });
  const request=(op,data={})=>new Promise((resolve,reject)=>{
    if(stopped)return reject(new Error('Agent control stopped; inspect the run before continuing'));
    const id=nextId++,payload=JSON.stringify({id,op,...data});
    if(Buffer.byteLength(payload)>100_000)return reject(new Error('Agent control request too large'));
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Agent control request timed out; inspect the run before continuing'));},timeoutMs);
    pending.set(id,{resolve,reject,timer});
    try{child.stdin.write(payload+'\n');}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
  });
  return {
    snapshot:()=>request('snapshot'),prompt:text=>request('prompt',{text}),
    answer:(requestId,answers)=>request('answer',{requestId,answers}),
    cancelQuestion:requestId=>request('cancel-question',{requestId}),
    close(){finish();child.stdin.end();lines.close();}
  };
}
