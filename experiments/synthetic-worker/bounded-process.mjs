import {spawn} from 'node:child_process';

export function cancellationError() {
  const error=new Error('Synthetic worker cancelled');
  error.name='AbortError';
  return error;
}

// Host-only helper. Stopping the CLI does not guarantee that daemon-side work
// has stopped; the caller must independently reconcile the Docker container.
export function runBoundedProcess(executable,args,{env,timeout,maxBytes,signal}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(cancellationError());return;}
    const child=spawn(executable,args,{env,stdio:['ignore','pipe','pipe']});
    let size=0,stdout=[],stderr=[],reason=null;
    const stop=why=>{if(reason)return;reason=why;child.kill('SIGKILL');};
    const onAbort=()=>stop('cancelled');
    signal?.addEventListener('abort',onAbort,{once:true});
    const timer=setTimeout(()=>stop('Command timed out'),timeout);
    if(signal?.aborted)onAbort();
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
    const collect=(target,chunk)=>{
      size+=chunk.length;
      if(size>maxBytes){stop('Output limit exceeded');return;}
      target.push(chunk);
    };
    child.stdout.on('data',chunk=>collect(stdout,chunk));
    child.stderr.on('data',chunk=>collect(stderr,chunk));
    child.on('error',error=>{cleanup();reject(reason==='cancelled'?cancellationError():error);});
    child.on('close',code=>{
      cleanup();
      if(reason){reject(reason==='cancelled'?cancellationError():new Error(reason));return;}
      resolve({code,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)});
    });
  });
}
