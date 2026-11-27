import {assertStudent,FIXED_TODAY,draft,applyApproved,applyAnnotation,snapshotForArchive,withSyntheticRuntime,runtimeDir,loadState,getRecoveryClaim,getStudent,readPlanningContext,confirmPlanningContext} from '../core.mjs';
import {createStudyBoundary} from './study-boundary.mjs';
import {createAvailabilityPreview} from './availability-preview.mjs';
import {createWriteGate} from './write-gate.mjs';
import {requiresStagedWorkspace} from '../domain/runtime.mjs';

// Trusted application side. Only its `agent` member may be exposed through
// the broker; approval methods require a separate authenticated user action.
// Draining covers operations in this process, not unknown external writers.
export function createTrustedStudyService({
  student,calendar,runtimeDirectory,trace,coldStart=false,browserStudy=false,clock,
  allowedStudents,requireStaged=true,schemaProfile='v1',disclosedSources,
}={}){
  assertStudent(student,allowedStudents);
  if(trace!==undefined&&typeof trace?.append!=='function')throw new Error('Invalid synthetic evidence trace');
  if(typeof requireStaged!=='boolean')throw new Error('Workspace policy must be explicit');
  const directory=runtimeDirectory===undefined?runtimeDir():runtimeDirectory;
  const workspace={allowedStudents:[student],requireStaged:requiresStagedWorkspace(requireStaged||schemaProfile==='eval-v2')};
  withSyntheticRuntime(directory,()=>{},workspace);
  const inRuntime=operation=>withSyntheticRuntime(directory,operation,workspace);
  const availabilityPreview=browserStudy?createAvailabilityPreview(calendar,student):null;
  const boundary=createStudyBoundary({
    student,calendar,coldStart,availabilityPreview,clock,...workspace,schemaProfile,disclosedSources,
  }),gate=createWriteGate(),agentCalls=new Set();
  const simulationToday=clock?.date||FIXED_TODAY;
  let retiring=false,drained=false;
  const agent={
    allowedMethods:()=>boundary.methods(),
    call(method,args){
    if(retiring)return Promise.reject(new Error('Synthetic run is retiring')); 
    const operation=Promise.resolve().then(async()=>{
      if(trace)await trace.append('tool',{phase:'requested',method,args});
      let traceFailed=false;
      try{
        return await inRuntime(()=>boundary.call(method,args,{
          afterExecute:trace?async result=>{
            try{await trace.append('tool',{phase:'completed',method,result});}
            catch(error){traceFailed=true;throw new Error('Evidence recording failed after the operation; state may have changed',{cause:error});}
          }:undefined,
        }));
      }
      catch(error){
        if(!traceFailed&&trace){try{await trace.append('failure',{operation:method,outcome:'failed'});}catch(traceError){throw new Error('Evidence recording failed after the operation; state may have changed',{cause:traceError});}}
        throw error;
      }
    });agentCalls.add(operation);
    operation.then(()=>agentCalls.delete(operation),()=>agentCalls.delete(operation));return operation;
  }};
  return {
    agent,availabilityPreview,
    ...(coldStart?{confirmPlanningContext:(id,replies)=>gate.run(async()=>{
      if(trace)await trace.append('decision',{operation:'confirm_planning_context',revisionId:id,operatorReplies:replies});
      return inRuntime(()=>confirmPlanningContext(student,id,replies));
    })}:{}),
    draftPlan:(options={})=>gate.run(async()=>{
      if(trace)await trace.append('decision',{operation:'draft_plan',options});
      return inRuntime(()=>draft(calendar,student,options,{...workspace,today:simulationToday}));
    }),
    status:()=>inRuntime(async()=>{
      const [state,recovery,courses,observation]=await Promise.all([
        loadState(student),getRecoveryClaim(),coldStart?readPlanningContext(student):getStudent(student,workspace),
        calendar.events(student).then(events=>({availability:'available',events})).catch(()=>({availability:'unavailable',events:null}))
      ]);
      return {state,recovery,courses,calendar:{availability:observation.availability},events:observation.events,
        ...(availabilityPreview?{availabilityOptions:availabilityPreview.observe(observation.events)}:{})};
    }),
    approvePlan:(planId,section)=>gate.run(async()=>{
      if(trace)await trace.append('decision',{operation:'approve_plan',planId,section});
      let result;try{result=await inRuntime(()=>applyApproved(calendar,student,planId,section));}
      catch(error){if(trace){try{await trace.append('failure',{operation:'approve_plan',planId,section,outcome:'failed_or_unknown'});}catch(traceError){throw new Error('Evidence recording failed after approval attempt; state may have changed',{cause:traceError});}}throw error;}
      if(trace){try{await trace.append('write',{operation:'approve_plan',planId,section,result});}catch(error){throw new Error('Evidence recording failed after approval; state may have changed',{cause:error});}}
      return result;
    }),
    approveAnnotation:id=>gate.run(async()=>{
      if(trace)await trace.append('decision',{operation:'approve_annotation',id});
      let result;try{result=await inRuntime(()=>applyAnnotation(calendar,student,id));}
      catch(error){if(trace){try{await trace.append('failure',{operation:'approve_annotation',id,outcome:'failed_or_unknown'});}catch(traceError){throw new Error('Evidence recording failed after approval attempt; state may have changed',{cause:traceError});}}throw error;}
      if(trace){try{await trace.append('write',{operation:'approve_annotation',id,result});}catch(error){throw new Error('Evidence recording failed after approval; state may have changed',{cause:error});}}
      return result;
    }),
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
