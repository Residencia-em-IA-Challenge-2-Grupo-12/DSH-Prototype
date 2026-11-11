import {createHash,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {prepareOpenRouterRequest} from './openrouter-policy.mjs';

const ENDPOINT='https://openrouter.ai/api/v1/chat/completions';
const digest=value=>createHash('sha256').update(value).digest();
const reply=(res,status,body)=>{if(!res.headersSent)res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
async function readBody(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>1_000_000)throw new Error('Request too large');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function estimatedCost(body,pricing){
  const age=Date.now()-Date.parse(pricing?.verifiedAt);
  if(!Number.isFinite(age)||age<0||age>86400000||![pricing?.inputPerMillion,pricing?.outputPerMillion].every(value=>Number.isFinite(value)&&value>0))throw new Error('Current provider pricing is required');
  // Deliberately conservative but not a provider token count or a hard cap.
  const inputTokens=Buffer.byteLength(JSON.stringify(body),'utf8')*2+4096;
  return (inputTokens*pricing.inputPerMillion+body.max_tokens*pricing.outputPerMillion)/1_000_000;
}
function billing(usage){
  return {actualUsd:Number.isFinite(usage?.cost)&&usage.cost>=0?usage.cost:null,
    inputTokens:Number.isSafeInteger(usage?.prompt_tokens)&&usage.prompt_tokens>=0?usage.prompt_tokens:null,
    outputTokens:Number.isSafeInteger(usage?.completion_tokens)&&usage.completion_tokens>=0?usage.completion_tokens:null};
}
async function forwardStream(upstream,res,budget,id){
  if(!upstream.body||!(upstream.headers.get('content-type')||'').includes('text/event-stream'))throw new Error('Invalid provider stream');
  const decoder=new TextDecoder();let pending='',done=false,usage=null,total=0;
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
  function frame(value){
    const data=value.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(data.trim()==='[DONE]'){done=true;return;}
    if(data){try{const parsed=JSON.parse(data);if(parsed.usage)usage=parsed.usage;}catch{/* Forward non-JSON provider frames without inferring usage. */}}
    if(res.destroyed)throw new Error('Client disconnected');
    res.write(value+'\n\n');
  }
  for await(const chunk of upstream.body){
    total+=chunk.length;if(total>5_000_000)throw new Error('Provider response is too large');
    pending+=decoder.decode(chunk,{stream:true});
    let separator;
    while((separator=/\r?\n\r?\n/.exec(pending))){const value=pending.slice(0,separator.index);pending=pending.slice(separator.index+separator[0].length);frame(value);}
    if(pending.length>1_000_000)throw new Error('Provider stream frame is too large');
  }
  pending+=decoder.decode();if(pending.trim())frame(pending);
  if(!done)throw new Error('Provider stream ended without completion');
  await budget.settle(id,billing(usage));
  res.end('data: [DONE]\n\n');
}

// Trusted gateway only. No key, prompt, provider response or raw upstream error
// is written to logs or the budget ledger. A local budget is not a hard cap.
export function createOpenRouterGateway({apiKey,accessToken,budget,pricing,fetchImpl=fetch}){
  if(typeof apiKey!=='string'||!apiKey.trim()||typeof accessToken!=='string'||!accessToken.trim())throw new Error('Gateway credentials are unavailable');
  if(!budget||typeof budget.reserve!=='function'||typeof budget.settle!=='function')throw new Error('A local comparison budget is required');
  const expected=digest(`Bearer ${accessToken}`);
  return createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/chat/completions')return reply(res,404,{error:'Unknown endpoint'});
    if(!timingSafeEqual(digest(req.headers.authorization||''),expected))return reply(res,401,{error:'Gateway authorization required'});
    let body,estimate,role;
    try {
      body=prepareOpenRouterRequest(await readBody(req));
      role=req.headers['x-study-role']||'agent';
      if(!['agent','judge','setup'].includes(role))throw new Error('Invalid request role');
      estimate=estimatedCost(body,pricing);
    } catch(error){return reply(res,400,{error:error.message});}
    let request;
    try {request=await budget.reserve({role,estimatedUsd:estimate});}
    catch(error){return reply(res,409,{error:error.message});}
    try {
      const upstream=await fetchImpl(ENDPOINT,{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
        body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)});
      if(!upstream.ok)throw new Error('Provider request failed');
      if(body.stream){await forwardStream(upstream,res,budget,request.id);return;}
      const payload=await upstream.json(),usage=payload?.usage;
      await budget.settle(request.id,billing(usage));
      return reply(res,200,payload);
    } catch {
      try {await budget.settle(request.id,{actualUsd:null});}catch{ /* Retain an unresolved reservation on local failure. */ }
      if(res.headersSent){res.destroy();return;}
      return reply(res,502,{error:'Provider request or usage accounting failed; further paid calls are blocked until inspected.'});
    }
  });
}
