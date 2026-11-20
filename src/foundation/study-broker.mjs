import http from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';

const MAX_REQUEST=64_000,MAX_RESPONSE=2_000_000;
export class BrokerTransportError extends Error {}
function checkedSocketPath(value){
  if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')||Buffer.byteLength(value)>100)throw new Error('An absolute, short broker socket path is required');
  return value;
}
const send=(res,status,payload)=>{
  const data=JSON.stringify(payload);
  if(Buffer.byteLength(data)>MAX_RESPONSE){res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"Broker response too large"}');return;}
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(data);
};

// Only a trusted controller creates this socket in a private per-run directory.
// No TCP listener, admin endpoint, provider credential or approval method is exposed.
export async function startStudyBroker({socketPath,boundary}={}){
  checkedSocketPath(socketPath);
  if(typeof boundary?.call!=='function')throw new Error('A study boundary is required');
  const directory=await fs.lstat(path.dirname(socketPath));
  if(!directory.isDirectory()||(directory.mode&0o077)!==0||(process.getuid&&directory.uid!==process.getuid()))throw new Error('Broker directory must be private and owned by the current user');
  try {await fs.lstat(socketPath);throw new Error('Broker socket path already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/call')return send(res,404,{error:'Unknown broker endpoint'});
    try {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>MAX_REQUEST)throw new Error('Broker request too large');chunks.push(chunk);}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!data||typeof data!=='object'||typeof data.method!=='string')throw new Error('Invalid broker request');
      if(data.method==='__broker_ping')return send(res,200,{result:true});
      return send(res,200,{result:await boundary.call(data.method,data.args)});
    } catch(error){return send(res,400,{error:typeof error?.message==='string'?error.message:'Broker request failed'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});
  try {await fs.chmod(socketPath,0o600);}catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
  let closed=false;
  return {async close(){if(closed)return;closed=true;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}

export function createStudyBrokerClient({socketPath}={}){
  checkedSocketPath(socketPath);
  return {ping(){return this.call('__broker_ping',{});},call(method,args){return new Promise((resolve,reject)=>{
    const payload=JSON.stringify({method,args});
    if(Buffer.byteLength(payload)>MAX_REQUEST)return reject(new Error('Broker request too large'));
    const req=http.request({socketPath,path:'/call',method:'POST',headers:{'content-type':'application/json'},timeout:30000},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>MAX_RESPONSE){res.destroy(new Error('Broker response too large'));return;}chunks.push(chunk);});
      res.on('error',error=>reject(new BrokerTransportError(error.message,{cause:error})));
      res.on('end',()=>{
        let data;
        try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
        catch(error){reject(new BrokerTransportError('Invalid broker response',{cause:error}));return;}
        if(res.statusCode===200&&data&&Object.hasOwn(data,'result'))resolve(data.result);
        else if(res.statusCode===400&&typeof data?.error==='string')reject(new Error(data.error));
        else reject(new BrokerTransportError('Invalid broker response'));
      });
    });
    req.on('timeout',()=>req.destroy(new Error('Broker request timed out')));
    req.on('error',error=>reject(new BrokerTransportError(error.message,{cause:error})));
    req.end(payload);
  });}};
}
