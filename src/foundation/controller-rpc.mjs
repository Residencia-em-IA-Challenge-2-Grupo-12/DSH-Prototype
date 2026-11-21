import {startStudyBroker,createStudyBrokerClient} from './study-broker.mjs';

const methods={
  runStatus:()=>[],start:a=>[a.student],retire:a=>[a.runId],status:a=>[a.runId],snapshot:a=>[a.runId],
  prompt:a=>[a.runId,a.text],answer:a=>[a.runId,a.requestId,a.answers,a.previewId],cancelQuestion:a=>[a.runId,a.requestId],
  confirmContext:a=>[a.runId,a.revisionId],approve:a=>[a.runId,a.planId,a.section],agentRead:a=>[a.runId,a.method,a.args]
};
// This private controller socket is never mounted in the agent. The browser
// process has only these operations, not the Docker daemon socket.
export function startControllerRpc({socketPath,api}){
  return startStudyBroker({socketPath,boundary:{call(method,args={}){
    if(!Object.hasOwn(methods,method)||!args||typeof args!=='object'||Array.isArray(args))throw Error('Controller operation unavailable');
    return api[method](...methods[method](args));
  }}});
}
export function createControllerClient({socketPath}){
  const client=createStudyBrokerClient({socketPath});
  return {
    runStatus:()=>client.call('runStatus',{}),start:student=>client.call('start',{student}),retire:runId=>client.call('retire',{runId}),
    status:runId=>client.call('status',{runId}),snapshot:runId=>client.call('snapshot',{runId}),
    prompt:(runId,text)=>client.call('prompt',{runId,text}),answer:(runId,requestId,answers,previewId)=>client.call('answer',{runId,requestId,answers,previewId}),
    cancelQuestion:(runId,requestId)=>client.call('cancelQuestion',{runId,requestId}),
    confirmContext:(runId,revisionId)=>client.call('confirmContext',{runId,revisionId}),
    approve:(runId,planId,section)=>client.call('approve',{runId,planId,section}),
    agentRead:(runId,method,args)=>client.call('agentRead',{runId,method,args})
  };
}
