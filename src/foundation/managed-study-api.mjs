// Trusted in-process API for the browser-facing adapter. The caller must
// authenticate and enforce its own local-origin policy before invoking it.
export function createManagedStudyApi({manager,driver}={}){
  if(typeof manager?.current!=='function'||typeof driver?.active!=='function')throw new Error('Managed lifecycle is required');
  async function selected(id){
    const run=await manager.current();
    if(!run||typeof id!=='string'||id!==run.id)throw new Error('Selected run changed; refresh the current run');
    const active=run.phase==='active'?driver.active(run.id):null;
    if(!active)throw new Error('Managed run is unavailable; resolve its recorded state before continuing');
    return active;
  }
  return {
    async runStatus(){const run=await manager.current();return {run,available:!!(run?.phase==='active'&&driver.active(run.id))};},
    start:student=>manager.start(student),
    async retire(runId){if(typeof runId!=='string'||!runId)throw new Error('Selected run is required');return manager.retire({expectedRunId:runId});},
    async snapshot(runId){return (await selected(runId)).client.snapshot();},
    async prompt(runId,text){return (await selected(runId)).client.prompt(text);},
    async answer(runId,requestId,answers){return (await selected(runId)).client.answer(requestId,answers);},
    async cancelQuestion(runId,requestId){return (await selected(runId)).client.cancelQuestion(requestId);},
    async approve(runId,planId,section){return (await selected(runId)).service.approvePlan(planId,section);},
    async agentRead(runId,method,args){
      const active=await selected(runId);
      if(!['list_calendar','list_synthetic_files','read_synthetic_file','routine_report'].includes(method))throw new Error('Managed read operation is not available');
      return active.service.agent.call(method,{...args,student:active.student});
    }
  };
}
