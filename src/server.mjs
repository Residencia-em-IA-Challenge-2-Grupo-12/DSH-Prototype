import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOT, Calendarpit, assertStudent, resetScenario, loadState, getStudent, listWorkspace, readWorkspace, draft, applyApproved, checkpoint, addFeedback, report, draftAnnotation, applyAnnotation } from './core.mjs';

const calendar=new Calendarpit(), PORT=Number(process.env.PORT || 4174);
const PUBLIC=path.join(ROOT,'public');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
function reply(res,status,data,type='application/json; charset=utf-8') {
  res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(type.startsWith('application/json')?JSON.stringify(data):data);
}
async function body(req) {
  let value=''; for await (const chunk of req) { value+=chunk; if(value.length>100_000) throw new Error('Request too large'); }
  return value ? JSON.parse(value) : {};
}
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://local.test');
    // Browser writes must originate from the same preview; no cross-origin API.
    if(req.method !== 'GET' && req.headers.origin && req.headers.origin !== 'http://'+req.headers.host) return reply(res,403,{error:'Cross-origin request denied'});
    if(url.pathname.startsWith('/api/')) {
      const args=req.method==='GET'?Object.fromEntries(url.searchParams):await body(req);
      const student=assertStudent(args.student||'ana');
      let result;
      if(req.method==='GET' && url.pathname==='/api/status') {
        const [s,events,courses]=await Promise.all([loadState(student),calendar.events(student),getStudent(student)]);
        result={state:s,events,courses};
      } else if(req.method==='GET' && url.pathname==='/api/workspace') result=await listWorkspace(student,args.path||'');
      else if(req.method==='GET' && url.pathname==='/api/file') result={content:await readWorkspace(student,args.path||'')};
      else if(req.method==='GET' && url.pathname==='/api/report') result=await report(calendar,student);
      else if(req.method==='POST' && url.pathname==='/api/reset') result=await resetScenario(calendar,student);
      else if(req.method==='POST' && url.pathname==='/api/propose') result=await draft(calendar,student,{weeks:args.weeks,hours:args.hours});
      else if(req.method==='POST' && url.pathname==='/api/approve') result=await applyApproved(calendar,student,args.planId,args.section);
      else if(req.method==='POST' && url.pathname==='/api/checkpoint') result=await checkpoint(calendar,student,args.reason||'');
      else if(req.method==='POST' && url.pathname==='/api/feedback') result=await addFeedback(student,args.feedback||{});
      else if(req.method==='POST' && url.pathname==='/api/annotation/propose') result=await draftAnnotation(calendar,student,args.eventId,args.category);
      else if(req.method==='POST' && url.pathname==='/api/annotation/approve') result=await applyAnnotation(calendar,student,args.id);
      else return reply(res,404,{error:'Unknown endpoint'});
      return reply(res,200,result);
    }
    if(req.method!=='GET') return reply(res,405,{error:'Method not allowed'});
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    let file;
    if(name==='vendor/i18next.js') file=path.join(ROOT,'node_modules/i18next/dist/umd/i18next.min.js');
    else { file=path.resolve(PUBLIC,name); if(!file.startsWith(PUBLIC+path.sep)) return reply(res,403,{error:'Forbidden'}); }
    const data=await fs.readFile(file);
    reply(res,200,data,mime[path.extname(file)]||'application/octet-stream');
  } catch(e) { reply(res,e.code==='ENOENT'?404:400,{error:e.message}); }
}).listen(PORT,'0.0.0.0',()=>console.log('Synthetic study preview listening on port '+PORT));
