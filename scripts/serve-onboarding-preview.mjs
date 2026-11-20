#!/usr/bin/env node
// Read-only preview of the curated generated package. No application/API forwarding.
import http from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=await realpath(path.join(root,'.runtime/onboarding-package'));
const host=process.env.STUDY_PREVIEW_BIND||'127.0.0.1',port=Number(process.env.PORT||4179);
if(!/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.split('.').some(n=>Number(n)>255)||host==='0.0.0.0'||!Number.isInteger(port)||port<1||port>65535)throw Error('Choose one explicit IPv4 preview interface and a valid port');
const hash=body=>createHash('sha256').update(body).digest('hex'),manifestBody=await readFile(path.join(directory,'manifest.json')),manifest=JSON.parse(manifestBody);
if(manifest.schemaVersion!==1||!Array.isArray(manifest.files))throw Error('Build the verified onboarding package first');
const allowed=new Map();
for(const entry of manifest.files){if(typeof entry.name!=='string'||entry.name.startsWith('/')||entry.name.split('/').some(n=>!n||n==='.'||n==='..')||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid manifest route');allowed.set('/'+entry.name,{file:path.join(directory,entry.name),sha:entry.sha256});}
allowed.set('/manifest.json',{file:path.join(directory,'manifest.json'),sha:hash(manifestBody)});allowed.set('/',allowed.get('/index.html'));
const zipPath=path.join(root,'.runtime/study-atlas-onboarding.zip'),zipBody=await readFile(zipPath);allowed.set('/onboarding.zip',{file:zipPath,sha:hash(zipBody),zip:true});
const origin=`http://${host}:${port}`;
const server=http.createServer(async(req,res)=>{
  function error(status,message){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify({error:message}));}
  if(req.headers.host!==`${host}:${port}`)return error(403,'Unexpected preview host');
  if(!['GET','HEAD'].includes(req.method))return error(405,'Read-only onboarding preview');
  const entry=allowed.get(new URL(req.url,origin).pathname);if(!entry)return error(404,'Artifact not found');
  try{
    const resolved=await realpath(entry.file);if(!entry.zip&&!resolved.startsWith(directory+path.sep))throw Error('Outside package');
    if(!(await stat(resolved)).isFile())throw Error('Not a file');const body=await readFile(resolved);if(hash(body)!==entry.sha)throw Error('Package changed; restart the verified preview');
    const scripts=entry.file.endsWith('.html')?[...body.toString().matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'"):[];
    const ext=path.extname(entry.file),mime={'.html':'text/html; charset=utf-8','.json':'application/json','.jpg':'image/jpeg','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.zip':'application/zip'}[ext]||'application/octet-stream';
    res.writeHead(200,{'content-type':mime,'content-length':body.length,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'self'; script-src 'self' ${scripts.join(' ')}; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`,...(entry.zip?{'content-disposition':'attachment; filename="study-atlas-onboarding.zip"'}:{})});res.end(req.method==='HEAD'?undefined:body);
  }catch{return error(503,'Verified artifact unavailable; rebuild/restart preview');}
});
server.listen(port,host,()=>console.log(`Read-only onboarding ${origin}/\nPortable package ${origin}/onboarding.zip`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
