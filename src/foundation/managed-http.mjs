// Browser adapter only. The trusted lifecycle/API is injected; no Docker
// command, provider origin or credential path is accepted from the browser.
export function createManagedHttpHandler({api,origin}={}){
  const allowed=new URL(origin);
  if(allowed.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(allowed.hostname)||allowed.origin!==origin)throw Error('A local HTTP origin is required');
  const routes={
    'GET /api/run':()=>api.runStatus(),
    'POST /api/run/start':a=>api.start(a.student),
    'POST /api/run/retire':a=>api.retire(a.runId),
    'GET /api/chat/state':a=>api.snapshot(a.runId),
    'POST /api/chat/send':a=>api.prompt(a.runId,a.text),
    'POST /api/chat/answer':a=>api.answer(a.runId,a.requestId,a.answers),
    'POST /api/chat/cancel-question':a=>api.cancelQuestion(a.runId,a.requestId),
    'POST /api/approve':a=>api.approve(a.runId,a.planId,a.section)
  };
  const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
  return async(req,res)=>{
    try{
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.host!==allowed.host)return reply(res,403,{error:'Local access required'});
      if(req.method!=='GET'&&req.headers.origin!==origin)return reply(res,403,{error:'Same-origin request required'});
      const url=new URL(req.url,origin),route=routes[`${req.method} ${url.pathname}`];
      if(!route)return reply(res,404,{error:'Managed operation not available'});
      let args;
      if(req.method==='GET')args=Object.fromEntries(url.searchParams);
      else{
        if((req.headers['content-type']||'').split(';')[0]!=='application/json')return reply(res,415,{error:'JSON required'});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>100000)throw Error('Request too large');chunks.push(chunk);}
        args=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!args||Array.isArray(args)||typeof args!=='object')throw Error('Invalid request');
      }
      return reply(res,200,await route(args));
    }catch(error){return reply(res,400,{error:error.message});}
  };
}
