// Trusted wrapper for a synthetic agent control client. The SDK's UI snapshot
// is bounded, so this is observed conversation evidence, not a full RPC log.
export function createExperimentSession({client,trace}={}){
  if(!client||typeof trace?.append!=='function')throw new Error('Synthetic session trace is required');
  const seenMessages=new Set(),seenQuestions=new Set();let queue=Promise.resolve();
  async function capture(view){
    if(!view||typeof view!=='object')throw new Error('Invalid synthetic session snapshot');
    for(const message of view.messages||[]){
      if(!message?.id||seenMessages.has(message.id)||message.type==='user')continue;
      await trace.append('message',{role:message.type,id:message.id,text:message.text,source:'bounded_sdk_snapshot'});
      seenMessages.add(message.id);
    }
    if(view.question?.requestId&&!seenQuestions.has(view.question.requestId)){
      await trace.append('question',{phase:'observed',question:view.question});seenQuestions.add(view.question.requestId);
    }
    return view;
  }
  const serial=operation=>{const next=queue.then(operation);queue=next.catch(()=>{});return next;};
  return {
    snapshot:()=>serial(async()=>capture(await client.snapshot())),
    prompt:text=>serial(async()=>{await trace.append('message',{role:'user',text});return capture(await client.prompt(text));}),
    answer:(requestId,answers)=>serial(async()=>{await trace.append('question',{phase:'answer',requestId,answers});return capture(await client.answer(requestId,answers));}),
    cancelQuestion:requestId=>serial(async()=>{await trace.append('question',{phase:'cancelled',requestId});return capture(await client.cancelQuestion(requestId));}),
    close:()=>client.close()
  };
}
