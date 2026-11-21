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
    async status(runId){return (await selected(runId)).service.status();},
    async prompt(runId,text){
      const active=await selected(runId);
      if(active.service.availabilityPreview){
        const view=await active.client.snapshot();
        if(view.busy||view.question)throw new Error('Finish the current question before sending a message');
        active.service.availabilityPreview.clear();
      }
      return active.client.prompt(text);
    },
    async answer(runId,requestId,answers,previewId){
      const active=await selected(runId);
      const preview=active.service.availabilityPreview;
      if(preview){
        const view=await active.client.snapshot();
        if(view.question?.requestId!==requestId)throw new Error('Question is no longer pending');
        const optionLabels=view.question.questions.flatMap(question=>(question.options||[]).map(option=>option.label));
        const shown=preview.observe()?.options.filter(option=>optionLabels.includes(option.label))||[];
        const labels=Array.isArray(answers)?answers.flatMap(answer=>Array.isArray(answer?.selected)?answer.selected:[]):[];
        if(labels.some(label=>shown.some(option=>option.label===label)))await preview.checkSelection(previewId,labels);
        // Consume only after the underlying session validates the answer. Clear
        // the exact preview we checked, even if the next turn publishes another.
        const current=preview.observe()?.id;
        const result=await active.client.answer(requestId,answers);
        if(preview.observe()?.id===current)preview.clear();
        return result;
      }
      return active.client.answer(requestId,answers);
    },
    async cancelQuestion(runId,requestId){
      const active=await selected(runId);
      const preview=active.service.availabilityPreview,current=preview?.observe()?.id;
      const result=await active.client.cancelQuestion(requestId);
      if(preview?.observe()?.id===current)preview?.clear();
      return result;
    },
    async confirmContext(runId,revisionId){
      const active=await selected(runId);
      if(!active.service.confirmPlanningContext)throw new Error('Planning context review is unavailable');
      const view=await active.client.snapshot();
      if(view.busy||view.question)throw new Error('Finish the current question before reviewing the context');
      const replies=view.messages.filter(message=>message.type==='user').slice(-20).map(message=>message.text.trim().slice(0,2000)).filter(Boolean);
      return active.service.confirmPlanningContext(revisionId,replies);
    },
    async approve(runId,planId,section){return (await selected(runId)).service.approvePlan(planId,section);},
    async agentRead(runId,method,args){
      const active=await selected(runId);
      if(!['list_calendar','list_synthetic_files','read_synthetic_file','routine_report'].includes(method))throw new Error('Managed read operation is not available');
      return active.service.agent.call(method,{...args,student:active.student});
    }
  };
}
