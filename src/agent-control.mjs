import {createInterface} from 'node:readline';

// Internal stdio control surface for one synthetic agent. Calendar approval,
// simulator administration and raw provider access are intentionally absent.
export function attachAgentControl({session,input,output}={}){
  if(!session||!input||!output)throw new Error('Agent control requires a session and streams');
  const lines=createInterface({input,crlfDelay:Infinity});let closed=false;
  const close=()=>{if(closed)return;closed=true;lines.close();session.stop();};
  const reply=value=>{if(!closed)output.write(JSON.stringify(value)+'\n');};
  lines.on('line',line=>{void (async()=>{
    let frame;
    try {
      if(Buffer.byteLength(line)>100_000)throw new Error('Agent control request too large');
      frame=JSON.parse(line);
      if(!frame||Array.isArray(frame)||typeof frame!=='object'||!Number.isSafeInteger(frame.id)||frame.id<1)throw new Error('Invalid agent control request');
      if(frame.op==='snapshot')return reply({id:frame.id,result:session.snapshot()});
      if(frame.op==='prompt')await session.prompt(frame.text);
      else if(frame.op==='answer')session.answer(frame.requestId,frame.answers);
      else if(frame.op==='cancel-question')session.cancelQuestion(frame.requestId);
      else throw new Error('Agent control operation is not available');
      return reply({id:frame.id,result:session.snapshot()});
    } catch(error){return reply({id:Number.isSafeInteger(frame?.id)&&frame.id>0?frame.id:null,error:typeof error?.message==='string'?error.message:'Agent control request failed'});}
  })();});
  lines.on('close',close);
  return {close};
}
