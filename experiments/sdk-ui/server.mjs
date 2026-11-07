import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDemo } from './runtime.mjs';

const assets=new Map([['/', ['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
function send(res,status,body,type='application/json; charset=utf-8') {res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(type.startsWith('application/json')?JSON.stringify(body):body);}
async function readBody(req){if((req.headers['content-type']||'').split(';')[0]!=='application/json')throw Error('JSON request required');let data='';for await(const chunk of req){data+=chunk;if(data.length>8192)throw Error('Request too large');}const value=JSON.parse(data);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('JSON object required');return value;}
export function createHandler(controller,getPort){return async(req,res)=>{
  try {
    const port=getPort(),host=`127.0.0.1:${port}`;
    if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==host)return send(res,403,{error:'Local loopback access only'});
    if(req.headers.origin&&req.headers.origin!==`http://${host}`)return send(res,403,{error:'Cross-origin request denied'});
    const url=new URL(req.url,`http://${host}`);if(url.search)return send(res,400,{error:'Query strings are not supported'});
    if(req.method==='GET'&&assets.has(url.pathname)){const [file,type]=assets.get(url.pathname);return send(res,200,await readFile(new URL(file,import.meta.url)),type);}
    if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,controller.state());
    if(req.method==='POST'&&url.pathname==='/api/plan'){const body=await readBody(req);if(Object.keys(body).length)throw Error('Unexpected fields');return send(res,200,await controller.propose());}
    if(req.method==='POST'&&url.pathname==='/api/review'){const body=await readBody(req);if(Object.keys(body).sort().join(',')!=='choice,proposalId'||typeof body.proposalId!=='string')throw Error('Invalid review request');return send(res,200,await controller.review(body.proposalId,body.choice));}
    send(res,404,{error:'Not found'});
  }catch(error){send(res,400,{error:error.message});}
};}
export function createLocalServer(controller) {let server;server=http.createServer(createHandler(controller,()=>server.address()?.port));return server;}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const demo=await createDemo(),server=createLocalServer(demo.controller),port=Number(process.env.PORT||'0');
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  console.log(`Synthetic shell: http://127.0.0.1:${server.address().port}/`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{demo.controller.close();process.exit(0)}));
}
