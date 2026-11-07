import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXED_TODAY = '2026-11-02';
const RUNTIME = path.join(ROOT, '.runtime');
const STUDENTS = ['ana', 'bruno'];
const writeLocks = new Set();
async function withWriteLock(student, fn) {
  if (writeLocks.has(student)) throw new Error('Another approval is being applied');
  writeLocks.add(student);
  try { return await fn(); } finally { writeLocks.delete(student); }
}
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const clone = (v) => structuredClone(v);
export function assertStudent(id) { if (!STUDENTS.includes(id)) throw new Error('Unknown fixture'); return id; }
export async function readJSON(p) { return JSON.parse(await fs.readFile(p, 'utf8')); }
export async function writeJSON(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.' + randomUUID() + '.tmp';
  await fs.writeFile(tmp, json(obj), { mode: 0o600 });
  await fs.rename(tmp, p);
}
export function statePath(student) { return path.join(RUNTIME, assertStudent(student) + '.json'); }
export async function loadState(student) { return readJSON(statePath(student)); }
export async function saveState(student, state) { return writeJSON(statePath(student), state); }
async function workspaceRoot(student) {
  assertStudent(student);
  const staged=path.join(RUNTIME,'workspaces',student);
  try { await fs.access(staged); return staged; } catch { return path.join(ROOT,'fixtures/students',student); }
}
export async function getStudent(student) {
  const root=await workspaceRoot(student);
  const data=await readJSON(path.join(root, 'courses.json'));
  for(const course of data.courses) {
    const text=await fs.readFile(await checkedPath(root,course.source),'utf8');
    const iso=text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const br=text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    const date=iso?.[1]||(br ? br[3]+'-'+br[2]+'-'+br[1] : null);
    const time=text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
    if(date) course.deadline=date+'T'+(time?time[0]:'18:00')+':00-03:00';
    else course.deadlineSourceWarning='No recognizable date; using fixture index as an assumption.';
  }
  return data;
}
export async function listWorkspace(student, relative = '') {
  const root = await workspaceRoot(student);
  const target = await checkedPath(root, relative);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.filter(e => !e.isSymbolicLink()).map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
}
async function checkedPath(root, relative) {
  const resolvedRoot = await fs.realpath(root);
  const candidate = await fs.realpath(path.resolve(root, relative || '.'));
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) throw new Error('Path is outside synthetic workspace');
  return candidate;
}
export async function readWorkspace(student, relative) {
  const root = await workspaceRoot(student);
  const p = await checkedPath(root, relative);
  const ext=path.extname(p).toLowerCase();
  if (!['.md', '.json', '.txt', '.pdf'].includes(ext)) throw new Error('Unsupported synthetic file type');
  const info = await fs.stat(p); if (info.size > 200_000) throw new Error('File too large');
  if(ext==='.pdf') {
    const {stdout}=await promisify(execFile)('pdftotext',['-layout',p,'-'],{timeout:5000,maxBuffer:500_000});
    return stdout;
  }
  return fs.readFile(p, 'utf8');
}

// Calendarpit management endpoints are deliberately local-only and synthetic.
export class Calendarpit {
  constructor(base = process.env.CALENDARPIT_URL || 'http://127.0.0.1:4173') {
    const u = new URL(base);
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) throw new Error('Calendarpit must be on loopback');
    this.base = u.origin;
  }
  async request(method, route, body) {
    const res = await fetch(this.base + '/__calendarpit' + route, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) throw new Error('Calendarpit ' + res.status + ': ' + text);
    return text ? JSON.parse(text) : null;
  }
  async events(student) { return (await this.request('GET', '/calendars/' + assertStudent(student) + '-calendar/events')).items; }
  async reset(student) {
    return this.request('POST', '/fixtures', await readJSON(path.join(ROOT, 'fixtures/calendars', assertStudent(student) + '.json')));
  }
  async create(student, event) { return this.request('POST', '/calendars/' + assertStudent(student) + '-calendar/events', event); }
  async patch(student, id, event) { return this.request('PATCH', '/calendars/' + assertStudent(student) + '-calendar/events/' + encodeURIComponent(id), event); }
  async remove(student, id) { return this.request('DELETE', '/calendars/' + assertStudent(student) + '-calendar/events/' + encodeURIComponent(id), {}); }
}
export function significant(e) {
  return { id: e.id, summary: e.summary, description: e.description || '', start: e.start, end: e.end,
    location: e.location || '', attendees: e.attendees || [], status: e.status || 'confirmed',
    transparency: e.transparency || 'opaque', extendedProperties: e.extendedProperties || {} };
}
export function snapshot(events) { return events.map(significant).sort((a,b) => a.id.localeCompare(b.id)); }
export function digest(events) { return createHash('sha256').update(JSON.stringify(snapshot(events))).digest('hex'); }
const millis = (item, key) => Date.parse(item[key]?.dateTime || item[key]?.date);
const overlaps = (a,b) => millis(a,'start') < millis(b,'end') && millis(b,'start') < millis(a,'end');
function localTime(date) { return date.toISOString().replace('Z','').slice(0,19) + '-03:00'; }

export function makePlan(student, events, { weeks = 4, hours, protectedIds = [], avoidDates = [], preferredPeriod, focusCourse } = {}) {
  const target = Number(hours ?? student.targetHours);
  if (!Number.isInteger(target) || target < 0 || target > 20) throw new Error('Hours must be a whole number between 0 and 20');
  const requested = Number(weeks);
  if (!Number.isInteger(requested) || requested < 1 || requested > 16) throw new Error('Weeks must be between 1 and 16');
  if (!Array.isArray(avoidDates) || avoidDates.length>112 || avoidDates.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error('Avoid dates must be ISO dates');
  if (preferredPeriod && !['morning','afternoon','evening'].includes(preferredPeriod)) throw new Error('Unknown preferred period');
  const focus=focusCourse ? student.courses.find(c=>c.name.toLocaleLowerCase()===String(focusCourse).toLocaleLowerCase()) : null;
  if(focusCourse&&!focus)throw new Error('Focus course is not in the student course index');
  const windows=student.studyWindows||[], maxDaily=student.maxDailyStudyHours??2, breakMinutes=student.studyBreakMinutes??15;
  const parseTime=value=>{if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new Error('Invalid study window time');return Number(value.slice(0,2))*60+Number(value.slice(3));};
  if(!Array.isArray(windows)||windows.length>30||!Number.isInteger(maxDaily)||maxDaily<1||maxDaily>12||!Number.isInteger(breakMinutes)||breakMinutes<0||breakMinutes>120)throw new Error('Invalid study availability');
  for(const window of windows)if(!Number.isInteger(window.weekday)||window.weekday<0||window.weekday>6||parseTime(window.end)<=parseTime(window.start))throw new Error('Invalid study window');
  const start = new Date(FIXED_TODAY + 'T00:00:00Z');
  const today = Date.parse(FIXED_TODAY + 'T00:00:00-03:00');
  const upcomingDeadlines = student.courses.map(c => Date.parse(c.deadline)).filter(deadline => deadline > today);
  const deadline = upcomingDeadlines.length ? Math.min(...upcomingDeadlines) : today;
  const maxWeeks = Math.max(1, Math.ceil((deadline - today) / (7 * 86400000)));
  const count = Math.min(requested, maxWeeks, 16);
  const horizonEnd=Date.parse(FIXED_TODAY+'T00:00:00-03:00')+count*7*86400000;
  const replaceable=events.filter(e => e.extendedProperties?.private?.studyDemo==='true' && e.extendedProperties?.private?.student===student.student && !protectedIds.includes(e.id) && millis(e,'start')>=Date.parse(FIXED_TODAY+'T00:00:00-03:00') && millis(e,'start')<horizonEnd);
  const replaceIds=new Set(replaceable.map(e=>e.id));
  const busy = events.filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent' && !replaceIds.has(e.id)).map(clone);
  const blocks = [], outlook = [];
  for (let w=0; w<count; w++) {
    let placed = 0;const daily=new Map(), weekBlocks=[], candidates=[];
    const sorted = [...student.courses].sort((a,b) => Date.parse(a.deadline)-Date.parse(b.deadline));
    for(let d=0;d<7;d++){
      const day=new Date(start.getTime()+(w*7+d)*86400000),dayKey=day.toISOString().slice(0,10);
      if(avoidDates.includes(dayKey))continue;
      for(const window of windows.filter(x=>x.weekday===day.getUTCDay()))for(let minute=parseTime(window.start);minute+60<=parseTime(window.end);minute+=15){
        const dt=new Date(day.getTime()+minute*60000),end=new Date(dt.getTime()+3600000),period=minute<720?'morning':minute<1080?'afternoon':'evening';
        candidates.push({d,dayKey,dt,period,start:{dateTime:localTime(dt),timeZone:student.timezone},end:{dateTime:localTime(end),timeZone:student.timezone}});
      }
    }
    while(placed<target && candidates.length){
      candidates.sort((a,b)=>(daily.get(a.dayKey)||0)-(daily.get(b.dayKey)||0) || (preferredPeriod?Number(a.period!==preferredPeriod)-Number(b.period!==preferredPeriod):0) || a.dt-b.dt);
      const candidate=candidates.shift();if((daily.get(candidate.dayKey)||0)>=maxDaily||busy.some(e=>overlaps(e,candidate)))continue;
      const cStart=millis(candidate,'start'),cEnd=millis(candidate,'end'),gap=breakMinutes*60000;
      if(weekBlocks.some(e=>cStart<millis(e,'end')+gap&&millis(e,'start')<cEnd+gap))continue;
      // Choose among courses that can actually use this block. An expired
      // course must not consume a candidate that another course can use.
      const eligible=sorted.filter(c=>cEnd<=Date.parse(c.deadline));
      if(!eligible.length)continue;
      const daysToDeadline=(Date.parse(eligible[0].deadline)-cStart)/86400000;
      const focused=focus&&eligible.includes(focus)?focus:null;
      const other=focused?eligible.find(c=>c!==focused):null;
      const course=focused?(placed%3===2&&other?other:focused):daysToDeadline<=14 && placed%3!==2?eligible[0]:eligible[(w+candidate.d)%eligible.length];
      const block={id:randomUUID().replaceAll('-',''),summary:'Study: '+course.name,start:candidate.start,end:candidate.end,
        status:w===0?'confirmed':'tentative',description:'Study planning demo. '+(w===0?'Near-term study block.':'Tentative; review at the next checkpoint.')+' Source: '+course.source,
        extendedProperties:{private:{studyDemo:'true',student:student.student,course:course.name}}};
      blocks.push(block);weekBlocks.push(block);busy.push(block);daily.set(candidate.dayKey,(daily.get(candidate.dayKey)||0)+1);placed++;
    }
    outlook.push({ week:w+1, targetHours:target, scheduledHours:placed, shortfall:Math.max(0,target-placed) });
  }
  return { id:randomUUID(), student:student.student, createdAt:new Date().toISOString(), fixedToday:FIXED_TODAY,
    sources:student.courses, assumptions:['Study blocks are suggestions; ask before writing.','Hours are goals, not evidence of actual study.',windows.length?'Study windows are stated possibilities; confirm they still suit the student.':'No study availability supplied; empty calendar time is not assumed available.',...(focus?['Course focus: '+focus.name+'; other courses may still receive blocks.']:[])],
    outlook, near:blocks.filter(b=>b.status==='confirmed'), future:blocks.filter(b=>b.status==='tentative'),
    remove:{near:replaceable.filter(e=>millis(e,'start')<Date.parse('2026-11-09T00:00:00-03:00')).map(significant),future:replaceable.filter(e=>millis(e,'start')>=Date.parse('2026-11-09T00:00:00-03:00')).map(significant)},
    baseHash:digest(events), status:{near:'pending',future:'pending'} };
}
export async function resetScenario(calendar, student) {
  assertStudent(student); await calendar.reset(student);
  const staged=path.join(RUNTIME,'workspaces',student);
  await fs.rm(staged,{recursive:true,force:true});
  await fs.mkdir(path.dirname(staged),{recursive:true});
  await fs.cp(path.join(ROOT,'fixtures/students',student),staged,{recursive:true});
  const events=await calendar.events(student);
  const feedback=(await readJSON(path.join(ROOT, 'fixtures/feedback', student+'.json'))).map(validateFeedback);
  const state={student,feedback,history:[],plan:null,lastSnapshot:snapshot(events),annotations:{},protectedIds:[]};
  await saveState(student,state); return state;
}
export async function draft(calendar, student, options={}) {
  const events=await calendar.events(student), state=await loadState(student);
  const unseen=diffSnapshots(state.lastSnapshot,events);
  state.protectedIds=[...new Set([...(state.protectedIds||[]),...unseen.filter(c=>c.before?.extendedProperties?.private?.studyDemo==='true').map(c=>c.id)])];
  const plan=makePlan(await getStudent(student), events, {...options,protectedIds:state.protectedIds||[]});
  state.plan=plan; state.history.push({type:'proposal',at:new Date().toISOString(),planId:plan.id,options});
  await saveState(student,state); return plan;
}
export async function applyApproved(calendar, student, planId, section) {
  return withWriteLock(student,()=>applyApprovedLocked(calendar,student,planId,section));
}
async function applyApprovedLocked(calendar, student, planId, section) {
  if (!['near','future'].includes(section)) throw new Error('Unknown approval section');
  const state=await loadState(student), plan=state.plan;
  if (!plan || plan.id!==planId || plan.status[section]!=='pending') throw new Error('Proposal not pending');
  const current=await calendar.events(student);
  if (digest(current)!==plan.baseHash) throw new Error('STALE: calendar changed; review a new proposal');
  const written=[];
  const removed=[];
  let expected=plan.baseHash;
  try {
    for (const old of (plan.remove?.[section]||[])) {
      if(digest(await calendar.events(student))!==expected) throw new Error('Calendar changed during application');
      await calendar.remove(student,old.id); removed.push(old.id); expected=digest(await calendar.events(student));
    }
    for (const block of plan[section]) {
      if(digest(await calendar.events(student))!==expected) throw new Error('Calendar changed during application');
      const result=await calendar.create(student,block); written.push(result.id);
      expected=digest(await calendar.events(student));
    }
    plan.status[section]='applied';
  } catch (err) {
    plan.status[section]='partial';
    state.history.push({type:'partial-write',section,at:new Date().toISOString(),written,removed,error:String(err)});
    state.lastSnapshot=snapshot(await calendar.events(student)); await saveState(student,state);
    throw new Error('PARTIAL: created '+JSON.stringify(written)+'; removed '+JSON.stringify(removed)+'. Inspect calendar before retry. '+err.message);
  }
  const after=await calendar.events(student);
  plan.baseHash=digest(after); state.lastSnapshot=snapshot(after);
  state.history.push({type:'approved',section,at:new Date().toISOString(),planId,written,removed});
  await saveState(student,state); return {written,removed,section};
}
export function diffSnapshots(before, after) {
  const a=new Map(snapshot(before).map(e=>[e.id,e])), b=new Map(snapshot(after).map(e=>[e.id,e]));
  const result=[];
  for (const id of new Set([...a.keys(),...b.keys()])) {
    const left=a.get(id),right=b.get(id);
    if (JSON.stringify(left)!==JSON.stringify(right)) result.push({id,before:left||null,after:right||null});
  } return result;
}
export async function checkpoint(calendar, student, reason='') {
  const state=await loadState(student), current=await calendar.events(student);
  const changes=diffSnapshots(state.lastSnapshot,current);
  state.protectedIds=[...new Set([...(state.protectedIds||[]),...changes.filter(c=>c.before?.extendedProperties?.private?.studyDemo==='true').map(c=>c.id)])];
  state.history.push({type:'checkpoint',at:new Date().toISOString(),reason,changes});
  state.lastSnapshot=snapshot(current); await saveState(student,state); return {changes,reason};
}
export function validateFeedback(input) {
  if (typeof input.eventId!=='string' || !input.eventId.trim()) throw new Error('eventId required');
  if (input.completion && !['completed','partial','not_done','unknown'].includes(input.completion)) throw new Error('Invalid completion');
  for (const key of ['actualMinutes','effort']) if (input[key]!==undefined && input[key]!==null && (!Number.isFinite(Number(input[key])) || Number(input[key])<0)) throw new Error('Invalid '+key);
  if (input.actualMinutes!==undefined && input.actualMinutes!==null && Number(input.actualMinutes)>1440) throw new Error('Actual minutes must be at most 1440');
  if (input.effort!==undefined && input.effort!==null && Number(input.effort)>5) throw new Error('Effort must be between 0 and 5');
  const recordedAt=input.recordedAt||new Date().toISOString();
  if (!Number.isFinite(Date.parse(recordedAt))) throw new Error('Invalid recordedAt');
  return {eventId:input.eventId.trim(),completion:input.completion||'unknown',actualMinutes:input.actualMinutes==null?null:Number(input.actualMinutes),effort:input.effort==null?null:Number(input.effort),note:String(input.note||'').slice(0,2000),recordedAt};
}
export async function addFeedback(student, input) {
  const state=await loadState(student), record=validateFeedback(input);
  state.feedback.push(record); await saveState(student,state); return record;
}
export async function draftAnnotation(calendar,student,eventId,category) {
  if(!['study','classes','work','rest','physical','other','unknown'].includes(category)) throw new Error('Invalid category');
  const state=await loadState(student),events=await calendar.events(student),event=events.find(e=>e.id===eventId);
  if(!event)throw new Error('Event not found');
  const start='[Study Atlas]',end='[/Study Atlas]',original=event.description||'';
  const pattern=/\n?\[Study Atlas\][\s\S]*?\[\/Study Atlas\]/g;
  const preserved=original.replace(pattern,'').trimEnd();
  const section=start+'\nCategory / Categoria: '+category+'\n'+end;
  const description=(preserved?preserved+'\n\n':'')+section;
  state.pendingAnnotation={id:randomUUID(),eventId,category,baseHash:digest(events),before:significant(event),after:{description,
    extendedProperties:{...(event.extendedProperties||{}),private:{...(event.extendedProperties?.private||{}),studyCategory:category}}}};
  await saveState(student,state);return state.pendingAnnotation;
}
export async function applyAnnotation(calendar,student,id) {
  return withWriteLock(student,()=>applyAnnotationLocked(calendar,student,id));
}
async function applyAnnotationLocked(calendar,student,id) {
  const state=await loadState(student),p=state.pendingAnnotation;
  if(!p||p.id!==id)throw new Error('Annotation proposal not pending');
  const events=await calendar.events(student);if(digest(events)!==p.baseHash)throw new Error('STALE: calendar changed; review again');
  await calendar.patch(student,p.eventId,p.after);
  state.annotations[p.eventId]={category:p.category,source:'user-confirmed',at:new Date().toISOString()};
  state.history.push({type:'annotation-approved',eventId:p.eventId,category:p.category,at:new Date().toISOString()});
  state.pendingAnnotation=null;state.lastSnapshot=snapshot(await calendar.events(student));await saveState(student,state);
  return {saved:true};
}
export function summarize(events, feedback, state) {
  function category(e) {
    const title=(e.summary||'').toLowerCase();
    return state.annotations?.[e.id]?.category||(/study|estudo/.test(title)?'study':/class|aula/.test(title)?'classes':/work|trabalho/.test(title)?'work':/sleep|rest|sono|descanso/.test(title)?'rest':/physical|exercise|exercício/.test(title)?'physical':'other');
  }
  function period(start,end) {
    const from=Date.parse(start),to=Date.parse(end),categories={study:0,classes:0,work:0,rest:0,physical:0,other:0,unknown:0};
    const included=events.filter(e=>e.status!=='cancelled' && millis(e,'start')<to && millis(e,'end')>from);
    for(const e of included) {
      const ms=Math.min(millis(e,'end'),to)-Math.max(millis(e,'start'),from);
      if(Number.isFinite(ms)&&ms>0)categories[category(e)]+=ms/3600000;
    }
    for(const k of Object.keys(categories))categories[k]=Math.round(categories[k]*100)/100;
    const ids=new Set(included.map(e=>e.id));
    const related=feedback.filter(f=>ids.has(f.eventId));
    return {start,end,categories,scheduledHours:Object.values(categories).reduce((a,b)=>a+b,0),
      feedbackCount:related.length,reportedMinutes:related.reduce((a,f)=>a+(f.actualMinutes||0),0),
      eventsWithoutFeedback:included.filter(e=>!feedback.some(f=>f.eventId===e.id)).length};
  }
  const recent=period('2026-10-26T00:00:00-03:00','2026-11-02T00:00:00-03:00');
  const upcoming=period('2026-11-02T00:00:00-03:00','2026-11-09T00:00:00-03:00');
  const categories=upcoming.categories;
  return {categories,scheduledHours:Object.values(categories).reduce((a,b)=>a+b,0),feedbackCount:feedback.length,
    reportedMinutes:feedback.reduce((a,f)=>a+(f.actualMinutes||0),0),missingCompletion:feedback.filter(f=>!f.completion||f.completion==='unknown').length,
    periods:{recent,upcoming},unmatchedFeedback:feedback.filter(f=>!events.some(e=>e.id===f.eventId)).length,
    outlook:state.plan?.outlook||[],history:state.history,narrative:state.narrative||null,limitations:['Scheduled time does not demonstrate completion.','Categories are heuristic and may need correction.','This is synthetic data, not a health assessment.']};
}
export async function report(calendar, student) {
  const state=await loadState(student), events=await calendar.events(student);
  const metrics=summarize(events,state.feedback,state);
  const out=path.join(RUNTIME,student+'-report.json'); await writeJSON(out,metrics);
  const markdown='# Synthetic routine report / Relatório sintético\n\nRecent week / Semana anterior: '+metrics.periods.recent.scheduledHours+'h scheduled; '+metrics.periods.recent.reportedMinutes+' minutes reported.\n\nComing week / Próxima semana: '+metrics.periods.upcoming.scheduledHours+'h scheduled.\n\nScheduled time is not proof of completion. / Tempo agendado não comprova realização.\n\n## Categories / Categorias\n\n'+Object.entries(metrics.categories).map(([k,v])=>'- '+k+': '+v+'h').join('\n')+'\n\n## Agent interpretation / Interpretação do agente\n\n'+(state.narrative||'Not yet provided by an agent. / Ainda não fornecida por um agente.')+'\n';
  await fs.writeFile(path.join(RUNTIME,student+'-report.md'),markdown); return metrics;
}
export async function saveNarrative(student, narrative) {
  if (typeof narrative!=='string'||narrative.length>12000) throw new Error('Invalid narrative');
  const state=await loadState(student); state.narrative=narrative; await saveState(student,state); return {saved:true};
}
