import path from 'node:path';
import {acquireControllerLease} from './controller-lease.mjs';
import {createRunManager} from './run-manager.mjs';

// This fences controller processes, not Docker containers or delayed writes.
// A real driver must still verify those resources before allowing replacement.
export async function createExclusiveRunManager({root,driver,driverFactory}={}){
  if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('An absolute lifecycle directory is required');
  if(driverFactory!==undefined&&(typeof driverFactory!=='function'||driver!==undefined))throw new Error('Choose a trusted lifecycle driver or driver factory');
  const lease=await acquireControllerLease({directory:path.join(root,'controller')});let manager,selected;
  try {selected=driverFactory?await driverFactory({root,lease}):driver;manager=await createRunManager({root,driver:selected});}
  catch(error){await lease.release();throw error;}
  const active=new Set();let closing=false,closePromise,shutdownComplete=false,managerClosed=false;
  const invoke=(name,args)=>{
    if(closing)return Promise.reject(new Error('Lifecycle controller is closing'));
    lease.assertHeld();
    const operation=Promise.resolve().then(()=>manager[name](...args));active.add(operation);
    operation.then(()=>active.delete(operation),()=>active.delete(operation));return operation;
  };
  return {
    current:()=>invoke('current',[]),completed:id=>invoke('completed',[id]),
    start:student=>invoke('start',[student]),retire:options=>invoke('retire',[options]),
    close(){
      if(closePromise)return closePromise;closing=true;
      closePromise=(async()=>{
        while(active.size)await Promise.allSettled([...active]);
        if(!shutdownComplete){if(typeof selected?.shutdown==='function')await selected.shutdown();shutdownComplete=true;}
        if(!managerClosed){await manager.close();managerClosed=true;}
        await lease.release();
      })();
      closePromise.catch(()=>{closePromise=null;});
      return closePromise;
    }
  };
}
