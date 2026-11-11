import {assertStudent,applyApproved,applyAnnotation,snapshotForArchive,withSyntheticRuntime} from '../core.mjs';
import {createStudyBoundary} from './study-boundary.mjs';
import {createWriteGate} from './write-gate.mjs';

// Trusted application side. Only its `agent` member may be exposed through
// the broker; approval methods require a separate authenticated user action.
// Draining covers operations in this process, not unknown external writers.
export function createTrustedStudyService({student,calendar,runtimeDirectory}={}){
  assertStudent(student);
  if(runtimeDirectory!==undefined)withSyntheticRuntime(runtimeDirectory,()=>{});
  const inRuntime=operation=>runtimeDirectory===undefined?operation():withSyntheticRuntime(runtimeDirectory,operation);
  const boundary=createStudyBoundary({student,calendar}),gate=createWriteGate(),agentCalls=new Set();
  let retiring=false,drained=false;
  const agent={call(method,args){
    if(retiring)return Promise.reject(new Error('Synthetic run is retiring')); 
    const operation=Promise.resolve().then(()=>inRuntime(()=>boundary.call(method,args)));agentCalls.add(operation);
    operation.then(()=>agentCalls.delete(operation),()=>agentCalls.delete(operation));return operation;
  }};
  return {
    agent,
    approvePlan:(planId,section)=>gate.run(()=>inRuntime(()=>applyApproved(calendar,student,planId,section))),
    approveAnnotation:id=>gate.run(()=>inRuntime(()=>applyAnnotation(calendar,student,id))),
    writerStatus:()=>gate.snapshot(),
    async drain(options){
      retiring=true;await gate.drain(options);
      while(agentCalls.size)await Promise.allSettled([...agentCalls]);
      drained=true;
    },
    async snapshotForArchive(){
      if(!drained||gate.snapshot().phase!=='closed')throw new Error('Synthetic run must be drained before archival');
      return inRuntime(()=>snapshotForArchive(student));
    }
  };
}
