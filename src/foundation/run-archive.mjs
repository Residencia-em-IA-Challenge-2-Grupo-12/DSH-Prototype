import {createHash,randomUUID} from 'node:crypto';
import {constants,promises as fs} from 'node:fs';
import path from 'node:path';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const identifier=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9._:@-]{1,128}$/.test(value))throw new Error('Invalid synthetic archive identifier');return value;};
const optionalId=value=>value==null?null:identifier(value);
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value??null)).digest('hex');
const stamp=value=>{if(value==null)return null;if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))throw new Error('Invalid synthetic archive timestamp');return new Date(value).toISOString();};
const word=value=>{if(value==null)return null;if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(value))throw new Error('Invalid synthetic archive status');return value;};
const number=value=>value==null?null:Number.isFinite(value)&&value>=0?value:(()=>{throw new Error('Invalid synthetic archive number');})();
const list=(value,project,limit=3000)=>{if(value==null)return [];if(!Array.isArray(value)||value.length>limit)throw new Error('Invalid synthetic archive list');return value.map(project);};
function eventTime(value){
  if(!value||typeof value!=='object')throw new Error('Invalid synthetic event time');
  if(value.dateTime!==undefined)return {dateTime:stamp(value.dateTime),timeZone:typeof value.timeZone==='string'&&/^[A-Za-z0-9_+/-]{1,64}$/.test(value.timeZone)?value.timeZone:null};
  if(typeof value.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.date))return {date:value.date};
  throw new Error('Invalid synthetic event time');
}
function event(value){
  if(!value||typeof value!=='object')throw new Error('Invalid synthetic event');
  return {id:identifier(value.id),start:eventTime(value.start),end:eventTime(value.end),status:word(value.status),transparency:word(value.transparency),
    summaryHash:hash(value.summary||''),descriptionHash:hash(value.description||''),locationHash:hash(value.location||''),
    attendeesHash:hash(value.attendees||[]),propertiesHash:hash(value.extendedProperties||{}),
    demoOwned:value.extendedProperties?.private?.studyDemo==='true'};
}
const maybeEvent=value=>value==null?null:event(value);
function plan(value){
  if(value==null)return null;
  return {id:identifier(value.id),status:{near:word(value.status?.near),future:word(value.status?.future)},
    baseHash:value.baseHash==null?null:(/^[a-f0-9]{64}$/.test(value.baseHash)?value.baseHash:(()=>{throw new Error('Invalid calendar hash');})()),
    near:list(value.near,event),future:list(value.future,event),
    remove:{near:list(value.remove?.near,event),future:list(value.remove?.future,event)},
    outlook:list(value.outlook,item=>({week:number(item.week),targetHours:number(item.targetHours),scheduledHours:number(item.scheduledHours),shortfall:number(item.shortfall)}),16)};
}
function action(value){
  return {actionId:identifier(value.actionId),type:word(value.type),event:maybeEvent(value.event),eventId:optionalId(value.eventId),
    before:maybeEvent(value.before),afterHash:value.after==null?null:hash(value.after)};
}
function claim(value,student){
  if(value==null)return null;
  if(value.student!==student)throw new Error('Archive claim student does not match');
  return {id:identifier(value.id),student,kind:word(value.kind),section:word(value.section),proposalId:optionalId(value.proposalId),
    decision:value.decision?{kind:word(value.decision.kind),section:word(value.decision.section),at:stamp(value.decision.at)}:null,
    proposal:plan(value.proposal),actions:list(value.actions,action),
    steps:list(value.steps,step=>({actionId:identifier(step.actionId),status:word(step.status),resultId:optionalId(step.resultId)}),12000),
    disposition:word(value.disposition),startedAt:stamp(value.startedAt),finishedAt:stamp(value.finishedAt)};
}
function history(value){
  return {type:word(value.type),at:stamp(value.at),section:word(value.section),planId:optionalId(value.planId),proposalId:optionalId(value.proposalId),
    written:list(value.written,identifier),removed:list(value.removed,identifier),observation:word(value.observation),
    unknownAction:value.unknownAction?{type:word(value.unknownAction.type),id:identifier(value.unknownAction.id)}:null,
    changes:list(value.changes,item=>({id:identifier(item.id),before:maybeEvent(item.before),after:maybeEvent(item.after)}))};
}
function state(value,student){
  if(value==null)return null;if(value.student!==student)throw new Error('Archive state student does not match');
  return {student,plan:plan(value.plan),protectedIds:list(value.protectedIds,identifier),
    lastSnapshot:list(value.lastSnapshot,event),history:list(value.history,history,12000),
    feedback:list(value.feedback,item=>({eventId:identifier(item.eventId),completion:word(item.completion),actualMinutes:number(item.actualMinutes),effort:number(item.effort),recordedAt:stamp(item.recordedAt)}))};
}
async function syncDirectory(directory){const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
async function verifyExisting(file,body){
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await handle.stat();
    if(!info.isFile()||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))throw new Error('Existing archive is not private');
    if(await handle.readFile('utf8')!==body)throw new Error('Different archive evidence already exists');
    await handle.sync();
  } finally {await handle.close();}
}

// The caller must first stop and verify every managed writer. This projection
// intentionally excludes arbitrary text, notes, raw errors, environment and
// credentials. It is synthetic evidence, not a portable replay bundle.
export async function archiveSyntheticRun({directory,run,snapshot,observation}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('An absolute archive directory is required');
  if(!uuid.test(run?.id||'')||!['ana','bruno'].includes(run?.student))throw new Error('Invalid synthetic archive run');
  if(stamp(run.createdAt)===null)throw new Error('Synthetic run creation time is required');
  if(snapshot?.schemaVersion!==1||!Array.isArray(snapshot.claimHistory))throw new Error('Invalid synthetic archive snapshot');
  if(!['available','unavailable','not_found'].includes(observation?.availability))throw new Error('Calendar observation availability is required');
  if(observation.availability==='available'&&!Array.isArray(observation.events))throw new Error('An available observation requires events');
  if(observation.availability!=='available'&&observation.events!==null)throw new Error('An unavailable observation cannot contain events');
  const student=run.student;
  const record={schemaVersion:1,run:{id:run.id,student,createdAt:stamp(run.createdAt)},
    snapshot:{schemaVersion:1,state:state(snapshot.state,student),claim:claim(snapshot.claim,student),claimHistory:list(snapshot.claimHistory,item=>claim(item,student),12000)},
    observation:{availability:observation.availability,observedAt:stamp(observation.observedAt),events:observation.availability==='available'?list(observation.events,event):null},
    omissions:['Free text, notes, raw errors, conversation, credential fields and raw workspace files are omitted.',
      'Event text and properties are represented by hashes; retained identifiers and timestamps must be synthetic.']};
  const body=JSON.stringify(record,null,2)+'\n';if(Buffer.byteLength(body)>8_000_000)throw new Error('Synthetic archive is too large');
  await fs.mkdir(directory,{recursive:true,mode:0o700});const dir=await fs.lstat(directory);
  if(!dir.isDirectory()||(dir.mode&0o077)!==0||(process.getuid&&dir.uid!==process.getuid()))throw new Error('Archive directory must be private');
  const target=path.join(directory,`${run.id}.json`),temporary=path.join(directory,`.${run.id}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await handle.writeFile(body);await handle.sync();await handle.close();handle=null;
    try{await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;await verifyExisting(target,body);}
    await syncDirectory(directory);
  } finally {await handle?.close();try{await fs.unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
  return {archiveId:run.id,sha256:hash(body)};
}
