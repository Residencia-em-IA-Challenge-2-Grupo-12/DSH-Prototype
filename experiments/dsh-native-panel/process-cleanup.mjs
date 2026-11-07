// Stop a spawned DSH child, confirming exit; `child.killed` only means a signal was sent.
function waitForExit(child,timeoutMs){
  if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve(true);
  return new Promise(resolve=>{
    const onExit=()=>{clearTimeout(timer);resolve(true);};
    const timer=setTimeout(()=>{child.off('exit',onExit);resolve(false);},timeoutMs);
    child.once('exit',onExit);
  });
}
export async function stopChild(child,{graceMs=3000,killGraceMs=3000}={}){
  if(!child||!child.pid||child.exitCode!==null||child.signalCode!==null)return;
  child.kill('SIGTERM');
  if(await waitForExit(child,graceMs))return;
  child.kill('SIGKILL');
  if(!await waitForExit(child,killGraceMs))throw Error('DSH child exit could not be confirmed after SIGKILL');
}
