import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { DomainStore } from './domain-store.mjs';

const MAX_BODY=64*1024;
class HttpError extends Error { constructor(status,message) { super(message);this.status=status; } }
function reply(res,status,body) {
  const json=JSON.stringify(body);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(json);
}
function readBody(req) {
  const type=(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(type!=='application/json')throw new HttpError(415,'Expected application/json');
  return new Promise((resolve,reject)=>{
    let total=0,tooLarge=false;const chunks=[];
    req.on('data',chunk=>{total+=chunk.length;if(total>MAX_BODY){tooLarge=true;chunks.length=0;}else if(!tooLarge)chunks.push(chunk);});
    req.on('end',()=>{
      if(tooLarge)return reject(new HttpError(413,'Request body too large'));
      try {
        const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();
        resolve(data);
      } catch { reject(new HttpError(400,'Expected a JSON object')); }
    });
    req.on('aborted',()=>reject(new HttpError(400,'Request aborted')));
    req.on('error',reject);
  });
}
function keys(value,expected) {
  if(Object.keys(value).some(k=>!expected.includes(k))||expected.some(k=>!(k in value)))throw new HttpError(400,'Unexpected or missing fields');
}
function classify(error) {
  if(error instanceof HttpError)return error;
  if(/^STALE:|already decided|not approved|Application |Action does not match/.test(error.message))return new HttpError(409,error.message);
  if(/^Unknown proposal|^Unknown application/.test(error.message))return new HttpError(404,error.message);
  if(/^Invalid |^Missing |must be an object|must be serializable/.test(error.message))return new HttpError(400,error.message);
  return new HttpError(500,'Internal service error');
}

// Local integration spike: no authentication and no calendar-provider actions.
export function createDomainService({filename=':memory:'}={}) {
  const store=new DomainStore(filename);
  const server=http.createServer(async(req,res)=>{
    try {
      const port=server.address()?.port;
      const host=`127.0.0.1:${port}`;
      if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==host)throw new HttpError(403,'Loopback access required');
      if(req.headers.origin&&req.headers.origin!==`http://${host}`)throw new HttpError(403,'Origin not allowed');
      const url=new URL(req.url,`http://${host}`);
      if(url.search)throw new HttpError(400,'Query parameters are not supported');
      let path;
      try {path=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);}catch{throw new HttpError(400,'Invalid path encoding');}
      if(req.method==='GET'&&path.join('/')==='health')return reply(res,200,{status:'ok',schema:3,calendarWrites:false});
      if(path.length<4||path[0]!=='v1'||path[1]!=='students')throw new HttpError(404,'Not found');
      const student=path[2],resource=path[3];
      if(req.method==='GET'&&resource==='versions'&&path.length===4)return reply(res,200,store.currentVersions(student));
      if(resource==='revisions'&&path.length===5&&req.method==='POST') {
        const body=await readBody(req);keys(body,['expectedVersion','payload']);
        return reply(res,201,store.addRevision(student,path[4],body.payload,body.expectedVersion));
      }
      if(resource==='revisions'&&path.length===6&&req.method==='GET') {
        if(!/^[1-9][0-9]*$/.test(path[5]))throw new HttpError(400,'Invalid version');
        const result=store.getRevision(student,path[4],Number(path[5]));
        if(!result)throw new HttpError(404,'Revision not found');
        return reply(res,200,result);
      }
      if(resource==='proposals'&&path.length===4&&req.method==='POST') {
        const body=await readBody(req);keys(body,['versions','payload']);
        return reply(res,201,store.createProposal(student,body.versions,body.payload));
      }
      if(resource==='proposals'&&path.length===5&&req.method==='GET') {
        const result=store.getProposal(student,path[4]);
        if(!result)throw new HttpError(404,'Proposal not found');
        return reply(res,200,result);
      }
      if(resource==='proposals'&&path.length===6&&path[5]==='decisions'&&req.method==='POST') {
        const body=await readBody(req);keys(body,['section','choice']);
        return reply(res,201,store.decide(student,path[4],body.section,body.choice));
      }
      if(resource==='proposals'&&path.length===6&&path[5]==='applications'&&req.method==='POST') {
        const body=await readBody(req);keys(body,['section','action']);
        try {return reply(res,201,store.claimApplication(student,path[4],body.section,body.action));}
        catch(error) {
          // These errors arise synchronously after the store has rolled back the
          // transaction and checked for an existing blocking application.
          const safe=/^STALE: (context|evidence|calendar) revision changed$/.test(error.message)||
            ['Section not approved','Action does not match approved proposal','Application already claimed','Unknown proposal'].includes(error.message);
          if(!safe)throw error;
          const classified=classify(error);
          return reply(res,classified.status,{error:classified.message,claimCommitted:false});
        }
      }
      if(resource==='applications'&&path.length===4&&req.method==='GET')return reply(res,200,{items:store.listApplications(student)});
      if(resource==='applications'&&path.length===5&&req.method==='GET') {
        const result=store.getApplication(student,path[4]);if(!result)throw new HttpError(404,'Application not found');
        return reply(res,200,result);
      }
      if(resource==='applications'&&path.length===6&&path[5]==='finish'&&req.method==='POST') {
        const body=await readBody(req);keys(body,['state','result']);
        return reply(res,200,store.finishApplication(student,path[4],body.state,body.result));
      }
      if(resource==='proposals'&&path.length===7&&path[5]==='decisions'&&req.method==='GET') {
        const result=store.getDecision(student,path[4],path[6]);
        if(!result)throw new HttpError(404,'Decision not found');
        return reply(res,200,result);
      }
      if(resource==='proposals'&&path.length===7&&path[5]==='approval'&&req.method==='GET')
        return reply(res,200,store.assertApprovalCurrent(student,path[4],path[6]));
      throw new HttpError(404,'Not found');
    } catch(error) {const e=classify(error);if(!res.headersSent)reply(res,e.status,{error:e.message});else res.destroy();}
  });
  server.requestTimeout=15000;
  server.headersTimeout=10000;
  return {
    async listen(port=0) {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});return server.address();},
    async close() {if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));store.close();},
    server
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const service=createDomainService({filename:process.env.DOMAIN_DB||'domain.sqlite'});
  const port=Number(process.env.PORT||'4176');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
  service.listen(port).then(address=>process.stdout.write(`Domain service listening at http://127.0.0.1:${address.port}\n`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>service.close().finally(()=>process.exit(0)));
}
