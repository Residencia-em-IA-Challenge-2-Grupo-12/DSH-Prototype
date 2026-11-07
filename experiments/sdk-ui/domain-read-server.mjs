// No approval or write route is provided. Do not expose the separate source
// domain service to an agent; its loopback HTTP API is unauthenticated.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readDomainView} from './domain-view.mjs';
const assets=new Map([['/',['compare-index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
function send(res,status,body,type='application/json; charset=utf-8'){
  res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(type.startsWith('application/json')?JSON.stringify(body):body);
}
export function createDomainReadHandler({origin,proposalId,fetchImpl},getPort){return async(req,res)=>{
  try{
    const host=`127.0.0.1:${getPort()}`;
    if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==host)return send(res,403,{error:'Local loopback access only'});
    if(req.headers.origin&&req.headers.origin!==`http://${host}`)return send(res,403,{error:'Cross-origin request denied'});
    const url=new URL(req.url,`http://${host}`);if(url.search)return send(res,400,{error:'Query strings are not supported'});
    if(req.method!=='GET')return send(res,405,{error:'Read-only comparison; no write or approval endpoint'});
    if(assets.has(url.pathname)){const [file,type]=assets.get(url.pathname);return send(res,200,await readFile(new URL(file,import.meta.url)),type);}
    if(url.pathname==='/api/state'){
      const view=await readDomainView({origin,proposalId,...(fetchImpl?{fetchImpl}:{})});
      return send(res,200,{events:view.calendar.events,proposal:view.proposal,calendarStatus:'shared-point-in-time',outcome:null,readOnly:true,stale:view.stale,student:view.student,versions:view.versions,simulationDate:'2026-11-02',timeZone:'America/Sao_Paulo'});
    }
    return send(res,404,{error:'Not found'});
  }catch(error){return send(res,503,{error:error.message});}
}}
export function createDomainReadServer(config){let server;server=http.createServer(createDomainReadHandler(config,()=>server.address()?.port));return server;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||'0');if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
  const server=createDomainReadServer({origin:process.env.DOMAIN_ORIGIN,proposalId:process.env.PROPOSAL_ID});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  console.log(`Synthetic read-only comparison: http://127.0.0.1:${server.address().port}/`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
}
