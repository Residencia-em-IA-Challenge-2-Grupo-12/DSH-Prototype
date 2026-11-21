import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createManagedHttpHandler} from './managed-http.mjs';

export function createManagedWeb({api,origin,publicDirectory}){
  const handler=createManagedHttpHandler({api,origin});
  return http.createServer(async(req,res)=>{
    const url=new URL(req.url,origin);
    if(url.pathname.startsWith('/api/'))return handler(req,res);
    if(req.method!=='GET'){res.writeHead(405);return res.end();}
    const file=({'/':'managed.html','/managed.js':'managed.js','/planning-review.js':'planning-review.js','/style.css':'style.css','/managed.css':'managed.css','/calendar-week.js':'calendar-week.js','/chat-message.js':'chat-message.js'})[url.pathname];
    if(!file){res.writeHead(404);return res.end();}
    try{const data=await readFile(path.join(publicDirectory,file));res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','cache-control':'no-store'});res.end(data);}
    catch{res.writeHead(500);res.end('Managed interface unavailable');}
  });
}
