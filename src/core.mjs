import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStateStore } from './state-store.mjs';
import {coldStartStudents,validatePlanningContext,reviewedPlannerProfile} from './cold-start-context.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXED_TODAY = '2026-11-02';
const runtimeContext=new AsyncLocalStorage();
// Trusted services may bind operations to a per-run runtime without changing
// process-wide environment; the legacy baseline keeps its existing override.
export function runtimeDir() { return path.resolve(runtimeContext.getStore()||process.env.STUDY_ATLAS_RUNTIME_DIR||path.join(ROOT,'.runtime')); }
export function withSyntheticRuntime(directory,operation){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||path.normalize(directory)!==directory||directory===path.parse(directory).root||typeof operation!=='function')throw new Error('A valid synthetic runtime and operation are required');
  return runtimeContext.run(directory,operation);
}
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
export function statePath(student) { return path.join(runtimeDir(), assertStudent(student) + '.json'); }
const stores=new Map();
const stateStore=new Proxy({}, {get(_target,key){
  const directory=runtimeDir();
  if(!stores.has(directory))stores.set(directory,createStateStore(directory));
  return stores.get(directory)[key];
}});
export async function disposeSyntheticRuntime(directory) {
  if(typeof directory!=='string'||!path.isAbsolute(directory)||path.normalize(directory)!==directory||directory===path.parse(directory).root)throw new Error('A valid synthetic runtime is required');
  const key=path.resolve(directory),store=stores.get(key);
  if(!store)return false;
  await store.close();
  if(stores.get(key)===store)stores.delete(key);
  return true;
}
export async function loadState(student) { return stateStore.load(assertStudent(student)); }
export async function saveState(student, state) { return stateStore.save(assertStudent(student),state); }
export async function getRecoveryClaim() { return stateStore.getCalendarClaim(); }
export async function snapshotForArchive(student) { return stateStore.snapshotForArchive(assertStudent(student)); }
async function workspaceRoot(student,requireStaged=false) {
  assertStudent(student);
  const staged=path.join(runtimeDir(),'workspaces',student);
  if(requireStaged){
    for(const directory of [path.dirname(staged),staged]){
      const entry=await fs.lstat(directory);
      if(!entry.isDirectory())throw new Error('Synthetic run workspace is unavailable');
    }
    return staged;
  }
  try { await fs.access(staged); return staged; } catch { return path.join(ROOT,'fixtures/students',student); }
}
export async function getStudent(student,{requireStaged=false}={}) {
  const root=await workspaceRoot(student,requireStaged);
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
export async function listWorkspace(student, relative = '',{requireStaged=false}={}) {
  const root = await workspaceRoot(student,requireStaged);
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
export async function readWorkspace(student, relative,{requireStaged=false}={}) {
  const root = await workspaceRoot(student,requireStaged);
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
    if (!res.ok) {const error=new Error('Calendarpit ' + res.status + ': ' + text);error.status=res.status;throw error;}
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
// The simulator uses fixed São Paulo time; all-day dates start at local midnight.
const millis = (item, key) => Date.parse(item[key]?.dateTime || (item[key]?.date && item[key].date + 'T00:00:00-03:00'));
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
  const scopedEnd=student.availabilityThrough
    ? Date.parse(student.availabilityThrough+'T00:00:00-03:00')+86400000
    : Infinity;
  const count = Math.min(requested, maxWeeks, 16, Math.ceil((scopedEnd-today)/(7*86400000)));
  const horizonEnd=Math.min(today+count*7*86400000,scopedEnd);
  const replaceable=events.filter(e => e.extendedProperties?.private?.studyDemo==='true' && e.extendedProperties?.private?.student===student.student && !protectedIds.includes(e.id) && millis(e,'start')>=Date.parse(FIXED_TODAY+'T00:00:00-03:00') && millis(e,'start')<horizonEnd);
  const replaceIds=new Set(replaceable.map(e=>e.id));
  const busy = events.filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent' && !replaceIds.has(e.id)).map(clone);
  const blocks = [], outlook = [];
  for (let w=0; w<count; w++) {
    let placed = 0;const daily=new Map(), weekBlocks=[], candidates=[];
    const sorted = [...student.courses].sort((a,b) => Date.parse(a.deadline)-Date.parse(b.deadline));
    for(let d=0;d<7;d++){
      const day=new Date(start.getTime()+(w*7+d)*86400000),dayKey=day.toISOString().slice(0,10);
      if(avoidDates.includes(dayKey)||(student.availabilityThrough&&dayKey>student.availabilityThrough))continue;
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
    sources:student.courses, assumptions:['Study blocks are suggestions; ask before writing.','Hours are goals, not evidence of actual study.',windows.length?'Study windows are stated possibilities; confirm they still suit the student.':'No study availability supplied; empty calendar time is not assumed available.',...(student.availabilityThrough?['Confirmed availability applies through '+student.availabilityThrough+'.']:[]),...(focus?['Course focus: '+focus.name+'; other courses may still receive blocks.']:[])],
    outlook, near:blocks.filter(b=>b.status==='confirmed'), future:blocks.filter(b=>b.status==='tentative'),
    remove:{near:replaceable.filter(e=>millis(e,'start')<Date.parse('2026-11-09T00:00:00-03:00')).map(significant),future:replaceable.filter(e=>millis(e,'start')>=Date.parse('2026-11-09T00:00:00-03:00')).map(significant)},
    baseHash:digest(events), status:{near:'pending',future:'pending'} };
}
// Initializes an already-seeded, fresh synthetic run. It does not invoke the
// simulator's administrative reset endpoint or overwrite an existing run.
export async function initializeScenario(calendar,student,{coldStart}={}) {
  assertStudent(student);
  if(coldStart!==undefined&&(!Object.hasOwn(coldStartStudents,coldStart)||coldStartStudents[coldStart]!==student))throw new Error('Unknown cold-start case for this student');
  try {await loadState(student);throw new Error('Synthetic scenario already initialized');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const events=await calendar.events(student);
  const expected=(await readJSON(path.join(ROOT,'fixtures/calendars',student+'.json'))).events;
  if(digest(events)!==digest(expected))throw new Error('Observed calendar does not match the synthetic fixture');
  const staged=path.join(runtimeDir(),'workspaces',student);
  await fs.mkdir(path.dirname(staged),{recursive:true});
  try {await fs.mkdir(staged);} catch(error){if(error.code==='EEXIST')throw new Error('Synthetic workspace already initialized');throw error;}
  await fs.cp(coldStart===undefined?path.join(ROOT,'fixtures/students',student):path.join(ROOT,'fixtures/cold-start',coldStart),staged,{recursive:true,force:false,errorOnExist:true});
  const feedback=(await readJSON(path.join(ROOT,'fixtures/feedback',student+'.json'))).map(validateFeedback);
  const state={student,feedback,history:[],plan:null,lastSnapshot:snapshot(events),annotations:{},protectedIds:[]};
  if(coldStart!==undefined)state.planningContext={caseId:coldStart,pending:null,confirmed:null};
  await stateStore.create(student,state);
  return state;
}
export async function resetScenario(calendar, student) {
  assertStudent(student);
  const id=randomUUID(),actionId='reset:'+student;
  await stateStore.acquireCalendarClaim({id,student,kind:'reset',actions:[{actionId}],startedAt:new Date().toISOString()});
  try {
    await stateStore.appendCalendarClaimStep(id,{actionId,status:'sent'});
    await calendar.reset(student);
    await stateStore.appendCalendarClaimStep(id,{actionId,status:'acknowledged'});
    const staged=path.join(runtimeDir(),'workspaces',student);
    await fs.rm(staged,{recursive:true,force:true});
    await fs.mkdir(path.dirname(staged),{recursive:true});
    await fs.cp(path.join(ROOT,'fixtures/students',student),staged,{recursive:true});
    const events=await calendar.events(student);
    const expected=(await readJSON(path.join(ROOT,'fixtures/calendars',student+'.json'))).events;
    if(digest(events)!==digest(expected))throw new Error('Observed calendar does not match the reset fixture');
    const feedback=(await readJSON(path.join(ROOT, 'fixtures/feedback', student+'.json'))).map(validateFeedback);
    const state={student,feedback,history:[],plan:null,lastSnapshot:snapshot(events),annotations:{},protectedIds:[]};
    await stateStore.appendCalendarClaimStep(id,{actionId,status:'confirmed'});
    await stateStore.completeCalendarClaim(id,{student,replacement:state});
    return state;
  } catch(error) {
    throw new Error('RESET UNRESOLVED: synthetic simulator or workspace may have changed; do not retry blindly. '+error.message);
  }
}
export async function readPlanningContext(student) {
  const context=(await loadState(student)).planningContext;
  if(!context)throw new Error('Planning context review is available for cold-start exercises');
  return context;
}

export async function proposePlanningContext(student,value) {
  await readPlanningContext(student);
  const record=await validatePlanningContext(value,
    path=>readWorkspace(student,path,{requireStaged:true}),FIXED_TODAY);
  const revision={id:randomUUID(),record};
  return stateStore.update(student,state=>{
    state.planningContext.pending=revision;
    return revision;
  },{requiresIdle:true});
}

// Only the operator-facing controller calls this. It is absent from the broker.
export async function confirmPlanningContext(student,revisionId,operatorReplies) {
  if(!Array.isArray(operatorReplies)||operatorReplies.length<1||operatorReplies.length>20||
      operatorReplies.some(value=>typeof value!=='string'||!value.trim()||value.length>2000)){
    throw new Error('Provide the original operator replies for review');
  }
  return stateStore.update(assertStudent(student),state=>{
    const context=state.planningContext;
    if(!context?.pending||context.pending.id!==revisionId)throw new Error('Planning context revision changed; review again');
    context.confirmed={...context.pending,operatorReplies:[...operatorReplies],confirmedAt:new Date().toISOString()};
    context.pending=null;
    state.plan=null;
    state.history.push({type:'planning_context_confirmed',revisionId,at:context.confirmed.confirmedAt});
    return context.confirmed;
  },{requiresIdle:true});
}

export async function draft(calendar, student, options={}, {requireStaged=false}={}) {
  const coldStart=(await loadState(student)).planningContext;
  const events=await calendar.events(student), baseline=coldStart?null:await getStudent(student,{requireStaged});
  return stateStore.update(assertStudent(student),state=>{
    const context=state.planningContext;
    if(context?.pending)throw new Error('The operator must review the pending planning context revision');
    const profile=context?reviewedPlannerProfile(student,context,FIXED_TODAY):baseline;
    if(context&&options.hours!==undefined&&options.hours!==profile.targetHours)throw new Error('Review a new planning context to change the confirmed hours');
    const unseen=diffSnapshots(state.lastSnapshot,events);
    state.protectedIds=[...new Set([...(state.protectedIds||[]),...unseen.filter(c=>c.before?.extendedProperties?.private?.studyDemo==='true').map(c=>c.id)])];
    const plan=makePlan(profile, events, {...options,...(context?{hours:profile.targetHours}:{}),protectedIds:state.protectedIds||[]});
    if(context)plan.planningContextRevisionId=context.confirmed.id;
    state.plan=plan; state.history.push({type:'proposal',at:new Date().toISOString(),planId:plan.id,options});
    return plan;
  },{requiresIdle:true});
}
export async function applyApproved(calendar, student, planId, section) {
  return withWriteLock(student,()=>applyApprovedLocked(calendar,student,planId,section));
}
async function applyApprovedLocked(calendar, student, planId, section) {
  if (!['near','future'].includes(section)) throw new Error('Unknown approval section');
  const state=await loadState(student), plan=state.plan;
  if (!plan || plan.id!==planId || plan.status[section]!=='pending') throw new Error('Proposal not pending');
  if(state.planningContext?.pending)throw new Error('STALE: review the pending planning context revision');
  const current=await calendar.events(student);
  if (digest(current)!==plan.baseHash) throw new Error('STALE: calendar changed; review a new proposal');
  const claimId=randomUUID();
  const actions=[...(plan.remove?.[section]||[]).map(event=>({actionId:'remove:'+event.id,type:'remove',event})),
    ...plan[section].map(event=>({actionId:'create:'+event.id,type:'create',event}))];
  await stateStore.acquireCalendarClaim({id:claimId,student,kind:'approval',proposalId:planId,section,proposal:plan,actions,
    decision:{kind:'approved',section,at:new Date().toISOString()},startedAt:new Date().toISOString()},
    {student,change:latest=>{
      if(latest.planningContext?.pending)throw new Error('STALE: review the pending planning context revision');
      if(JSON.stringify(latest.plan)!==JSON.stringify(plan)||latest.plan?.status[section]!=='pending')throw new Error('Proposal not pending');
      latest.plan.status[section]='applying';
    }});
  const written=[];
  const removed=[];
  let expected=plan.baseHash;
  let expectedEvents=current;
  let after,attempt=null,sent=false;
  try {
    for (const old of (plan.remove?.[section]||[])) {
      if(digest(await calendar.events(student))!==expected) throw new Error('Calendar changed during application');
      attempt={type:'remove',id:old.id};
      const actionId='remove:'+old.id;
      await stateStore.appendCalendarClaimStep(claimId,{actionId,status:'sent'});sent=true;
      await calendar.remove(student,old.id); removed.push(old.id); attempt=null;
      await stateStore.appendCalendarClaimStep(claimId,{actionId,status:'acknowledged'});
      expectedEvents=expectedEvents.filter(event=>event.id!==old.id);
      const observed=await calendar.events(student);
      if(digest(observed)!==digest(expectedEvents))throw new Error('Calendar changed during application');
      await stateStore.appendCalendarClaimStep(claimId,{actionId,status:'confirmed'});
      expectedEvents=observed;expected=digest(observed);
    }
    for (const block of plan[section]) {
      if(digest(await calendar.events(student))!==expected) throw new Error('Calendar changed during application');
      attempt={type:'create',id:block.id};
      const actionId='create:'+block.id;
      await stateStore.appendCalendarClaimStep(claimId,{actionId,status:'sent'});sent=true;
      const result=await calendar.create(student,block); written.push(result.id);attempt=null;
      await stateStore.appendCalendarClaimStep(claimId,{actionId,status:'acknowledged',resultId:result.id});
      expectedEvents=[...expectedEvents,result];
      const observed=await calendar.events(student);
      if(digest(observed)!==digest(expectedEvents))throw new Error('Calendar changed during application');
      await stateStore.appendCalendarClaimStep(claimId,{actionId,status:'confirmed'});
      expectedEvents=observed;expected=digest(observed);
    }
    after=await calendar.events(student);
    if(digest(after)!==expected)throw new Error('Calendar changed during application');
  } catch (err) {
    if(!sent){
      await stateStore.cancelCalendarClaim(claimId,{student,change:latest=>{
        if(latest.plan?.id===planId&&latest.plan.status[section]==='applying')latest.plan.status[section]='pending';
      }});
      throw err;
    }
    let observed=null;
    try {observed=await calendar.events(student);} catch { /* Preserve the last trusted snapshot. */ }
    await stateStore.update(assertStudent(student),latest=>{
      if(latest.plan?.id===planId)latest.plan.status[section]='partial';
      if(observed){
        const edited=diffSnapshots(latest.lastSnapshot,observed).filter(change=>change.before?.extendedProperties?.private?.studyDemo==='true'&&!removed.includes(change.id));
        latest.protectedIds=[...new Set([...(latest.protectedIds||[]),...edited.map(change=>change.id)])];
      }
      latest.history.push({type:'partial-write',section,at:new Date().toISOString(),planId,written,removed,error:String(err),observation:observed?'available':'unavailable',...(observed?{observedSnapshot:snapshot(observed)}:{}),...(attempt?{unknownAction:attempt}:{})});
    });
    throw new Error('PARTIAL: created '+JSON.stringify(written)+'; removed '+JSON.stringify(removed)+(attempt?'; outcome unknown for '+JSON.stringify(attempt):'')+'. '+(observed?'Inspect calendar before retry.':'Calendar observation unavailable; inspect when available.')+' '+err.message);
  }
  await stateStore.completeCalendarClaim(claimId,{student,change:latest=>{
    if(latest.plan?.id!==planId||latest.plan.status[section]!=='applying')throw new Error('Approved proposal changed while applying');
    latest.plan.status[section]='applied';latest.plan.baseHash=digest(after);
    latest.lastSnapshot=snapshot(after);
    latest.history.push({type:'approved',section,at:new Date().toISOString(),planId,written,removed});
  }});
  return {written,removed,section};
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
  const current=await calendar.events(student);
  return stateStore.update(assertStudent(student),state=>{
    const changes=diffSnapshots(state.lastSnapshot,current);
    state.protectedIds=[...new Set([...(state.protectedIds||[]),...changes.filter(c=>c.before?.extendedProperties?.private?.studyDemo==='true').map(c=>c.id)])];
    state.history.push({type:'checkpoint',at:new Date().toISOString(),reason,changes});
    state.lastSnapshot=snapshot(current); return {changes,reason};
  },{requiresIdle:true});
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
  const record=validateFeedback(input);
  return stateStore.update(assertStudent(student),state=>{state.feedback.push(record);return record;});
}
export async function draftAnnotation(calendar,student,eventId,category) {
  if(!['study','classes','work','rest','physical','other','unknown'].includes(category)) throw new Error('Invalid category');
  const events=await calendar.events(student),event=events.find(e=>e.id===eventId);
  if(!event)throw new Error('Event not found');
  const start='[Study Atlas]',end='[/Study Atlas]',original=event.description||'';
  const pattern=/\n?\[Study Atlas\][\s\S]*?\[\/Study Atlas\]/g;
  const preserved=original.replace(pattern,'').trimEnd();
  const section=start+'\nCategory / Categoria: '+category+'\n'+end;
  const description=(preserved?preserved+'\n\n':'')+section;
  return stateStore.update(assertStudent(student),state=>{
    state.pendingAnnotation={id:randomUUID(),eventId,category,baseHash:digest(events),before:significant(event),after:{description,
      extendedProperties:{...(event.extendedProperties||{}),private:{...(event.extendedProperties?.private||{}),studyCategory:category}}}};
    return state.pendingAnnotation;
  },{requiresIdle:true});
}
export async function applyAnnotation(calendar,student,id) {
  return withWriteLock(student,()=>applyAnnotationLocked(calendar,student,id));
}
async function applyAnnotationLocked(calendar,student,id) {
  const state=await loadState(student),p=state.pendingAnnotation;
  if(!p||p.id!==id||(p.status&&p.status!=='pending'))throw new Error('Annotation proposal not pending');
  const events=await calendar.events(student);if(digest(events)!==p.baseHash)throw new Error('STALE: calendar changed; review again');
  const claimId=randomUUID(),actionId='patch:'+p.eventId;
  await stateStore.acquireCalendarClaim({id:claimId,student,kind:'annotation',proposalId:id,proposal:p,decision:{kind:'approved',at:new Date().toISOString()},
    actions:[{actionId,type:'patch',eventId:p.eventId,before:p.before,after:p.after}],startedAt:new Date().toISOString()},
    {student,change:latest=>{
      if(JSON.stringify(latest.pendingAnnotation)!==JSON.stringify(p))throw new Error('Annotation proposal not pending');
      latest.pendingAnnotation.status='applying';
    }});
  let acknowledged=false,after,sent=false;
  try {
    if(digest(await calendar.events(student))!==p.baseHash)throw new Error('STALE: calendar changed; review again');
    await stateStore.appendCalendarClaimStep(claimId,{actionId,status:'sent'});sent=true;
    await calendar.patch(student,p.eventId,p.after);acknowledged=true;
    await stateStore.appendCalendarClaimStep(claimId,{actionId,status:'acknowledged'});
    after=await calendar.events(student);
    const expected=events.map(event=>event.id===p.eventId?{...event,...p.after}:event);
    if(digest(after)!==digest(expected))throw new Error('Calendar changed during annotation');
    await stateStore.appendCalendarClaimStep(claimId,{actionId,status:'confirmed'});
  } catch(error) {
    if(!sent){
      await stateStore.cancelCalendarClaim(claimId,{student,change:latest=>{
        if(latest.pendingAnnotation?.id===id)latest.pendingAnnotation=p;
      }});
      throw error;
    }
    let observed=null;try {observed=await calendar.events(student);} catch { /* Keep the last trusted snapshot. */ }
    await stateStore.update(assertStudent(student),latest=>{
      if(latest.pendingAnnotation?.id===id)latest.pendingAnnotation.status='partial';
      if(observed){
        const edited=diffSnapshots(latest.lastSnapshot,observed).filter(change=>change.before?.extendedProperties?.private?.studyDemo==='true');
        latest.protectedIds=[...new Set([...(latest.protectedIds||[]),...edited.map(change=>change.id)])];
      }
      latest.history.push({type:'annotation-partial',proposalId:id,eventId:p.eventId,at:new Date().toISOString(),acknowledged,observation:observed?'available':'unavailable',...(observed?{observedSnapshot:snapshot(observed)}:{}),error:String(error)});
    });
    throw new Error('PARTIAL: annotation '+(acknowledged?'acknowledged; resulting calendar needs review':'outcome unknown')+'. '+error.message);
  }
  await stateStore.completeCalendarClaim(claimId,{student,change:latest=>{
    if(latest.pendingAnnotation?.id!==id||latest.pendingAnnotation.status!=='applying')throw new Error('Annotation proposal changed while applying');
    latest.annotations[p.eventId]={category:p.category,source:'user-confirmed',at:new Date().toISOString()};latest.pendingAnnotation=null;
    latest.history.push({type:'annotation-approved',eventId:p.eventId,category:p.category,at:new Date().toISOString()});
    latest.lastSnapshot=snapshot(after);
  }});
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
  const out=path.join(runtimeDir(),student+'-report.json'); await writeJSON(out,metrics);
  const markdown='# Synthetic routine report / Relatório sintético\n\nRecent week / Semana anterior: '+metrics.periods.recent.scheduledHours+'h scheduled; '+metrics.periods.recent.reportedMinutes+' minutes reported.\n\nComing week / Próxima semana: '+metrics.periods.upcoming.scheduledHours+'h scheduled.\n\nScheduled time is not proof of completion. / Tempo agendado não comprova realização.\n\n## Categories / Categorias\n\n'+Object.entries(metrics.categories).map(([k,v])=>'- '+k+': '+v+'h').join('\n')+'\n\n## Agent interpretation / Interpretação do agente\n\n'+(state.narrative||'Not yet provided by an agent. / Ainda não fornecida por um agente.')+'\n';
  await fs.writeFile(path.join(runtimeDir(),student+'-report.md'),markdown); return metrics;
}
export async function saveNarrative(student, narrative) {
  if (typeof narrative!=='string'||narrative.length>12000) throw new Error('Invalid narrative');
  return stateStore.update(assertStudent(student),state=>{state.narrative=narrative;return {saved:true};});
}
