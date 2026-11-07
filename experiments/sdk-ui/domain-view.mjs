// Read-only comparison adapter. This is a synthetic local experiment, not an
// authorization boundary: the source domain service is unauthenticated.
const KINDS=['context','evidence','calendar'];
const WEEK_START=Date.parse('2026-11-02T00:00:00-03:00');
const WEEK_END=Date.parse('2026-11-09T00:00:00-03:00');
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function originOf(value){
  let url;try{url=new URL(value)}catch{throw Error('A loopback origin is required')}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('A loopback origin is required');
  return url.origin;
}
function validVersions(v){return !!v&&typeof v==='object'&&KINDS.every(k=>Number.isSafeInteger(v[k])&&v[k]>0)}
function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function instant(value){
  if(typeof value!=='string')return null;
  const match=/^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,9})?)?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if(!match||!validDate(match[1])||Number(match[2])>23||Number(match[3])>59||(match[4]!==undefined&&Number(match[4])>59))return null;
  if(match[5]!=='Z'){
    const [hours,minutes]=match[5].slice(1).split(':').map(Number);
    if(hours>14||minutes>59||(hours===14&&minutes!==0))return null;
  }
  const result=Date.parse(value);return Number.isFinite(result)?result:null;
}
function local(millis){
  const parts=Object.fromEntries(formatter.formatToParts(new Date(millis)).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};
}
function validExistingEvent(event){
  if(!event||typeof event!=='object'||Array.isArray(event)||typeof event.id!=='string'||!event.id)return false;
  if(event.status==='cancelled')return true;
  if(![undefined,'confirmed','tentative'].includes(event.status)||![undefined,'opaque','transparent'].includes(event.transparency)||typeof event.summary!=='string'||!event.start||!event.end)return false;
  if('recurrence' in event||(event.endTimeUnspecified!==undefined&&event.endTimeUnspecified!==false)||(Object.prototype.hasOwnProperty.call(event,'recurringEventId')&&(typeof event.recurringEventId!=='string'||!event.recurringEventId.trim())))return false;
  const timed=event.start.dateTime!==undefined||event.end.dateTime!==undefined;
  const allDay=event.start.date!==undefined||event.end.date!==undefined;
  if(timed===allDay)return false;
  if(allDay)return validDate(event.start.date)&&validDate(event.end.date)&&event.start.date<event.end.date;
  const start=instant(event.start.dateTime),end=instant(event.end.dateTime);
  return start!==null&&end!==null&&start<end;
}
function validProposalShape(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['sections','sources','assumptions'].includes(key)))return false;
  for(const key of ['sources','assumptions'])if(payload[key]!==undefined&&(!Array.isArray(payload[key])||payload[key].some(value=>typeof value!=='string')))return false;
  const sections=payload.sections;
  if(!sections||typeof sections!=='object'||Array.isArray(sections)||Object.keys(sections).some(key=>key!=='near'))return false;
  const near=sections.near;
  if(!near||typeof near!=='object'||Array.isArray(near)||Object.keys(near).some(key=>key!=='action'))return false;
  const action=near.action,event=action?.event;
  if(!action||typeof action!=='object'||Array.isArray(action)||action.type!=='create'||typeof action.calendarId!=='string'||!action.calendarId||Object.keys(action).some(key=>!['type','calendarId','event'].includes(key))||!event||typeof event!=='object'||Array.isArray(event)||typeof event.id!=='string'||!/^[a-v0-9]{5,128}$/.test(event.id)||typeof event.summary!=='string'||!event.summary.trim()||event.start?.date!==undefined||event.end?.date!==undefined)return false;
  if(Object.keys(event).some(key=>!['id','summary','description','start','end','status','transparency','extendedProperties'].includes(key))||![undefined,'confirmed','tentative'].includes(event.status)||![undefined,'opaque'].includes(event.transparency)||(event.description!==undefined&&typeof event.description!=='string')||event.extendedProperties?.private?.studyDemo!=='true'||event.extendedProperties?.private?.student!=='ana')return false;
  const props=event.extendedProperties,privateProps=props?.private;
  if(!props||typeof props!=='object'||Array.isArray(props)||Object.keys(props).some(key=>key!=='private')||!privateProps||typeof privateProps!=='object'||Array.isArray(privateProps)||Object.keys(privateProps).some(key=>!['studyDemo','student','course'].includes(key))||(privateProps.course!==undefined&&typeof privateProps.course!=='string'))return false;
  for(const endpoint of [event.start,event.end])if(!endpoint||typeof endpoint!=='object'||Array.isArray(endpoint)||Object.keys(endpoint).some(key=>!['dateTime','timeZone'].includes(key))||(endpoint.timeZone!==undefined&&endpoint.timeZone!=='America/Sao_Paulo'))return false;
  const start=instant(event.start?.dateTime),end=instant(event.end?.dateTime);
  if(start===null||end===null||start>=end||start<WEEK_START||end>WEEK_END)return false;
  const a=local(start),b=local(end);
  // The narrow renderer only displays same-day blocks at minute granularity.
  return a.date===b.date&&a.date>='2026-11-02'&&a.date<='2026-11-08'&&b.minute>a.minute;
}
export async function readDomainView({origin,proposalId,fetchImpl=globalThis.fetch}){
  origin=originOf(origin);
  if(typeof proposalId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(proposalId))throw Error('Synthetic proposal is required');
  if(typeof fetchImpl!=='function')throw Error('Fetch implementation is required');
  const root=origin+'/v1/students/ana';
  const get=async suffix=>{
    const response=await fetchImpl(root+suffix,{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Domain read failed (HTTP '+response.status+')');
    return response.json();
  };
  const versions=await get('/versions');if(!validVersions(versions))throw Error('Complete domain revisions are required');
  const [calendar,proposal]=await Promise.all([get('/revisions/calendar/'+versions.calendar),get('/proposals/'+proposalId)]);
  if(calendar?.student!=='ana'||calendar.kind!=='calendar'||calendar.version!==versions.calendar||!Array.isArray(calendar.payload?.events))throw Error('Invalid calendar revision identity or events');
  const snapshot=calendar.payload;
  if(typeof snapshot.calendarId!=='string'||!snapshot.calendarId||snapshot.timeZone!=='America/Sao_Paulo'||instant(snapshot.timeMin)!==WEEK_START||instant(snapshot.timeMax)!==WEEK_END)throw Error('Unsupported calendar identity or week');
  if(!snapshot.events.every(validExistingEvent)||new Set(snapshot.events.map(event=>event.id)).size!==snapshot.events.length)throw Error('Invalid calendar event');
  if(proposal?.student!=='ana'||proposal.id!==proposalId||!validVersions(proposal.versions)||!validProposalShape(proposal.payload))throw Error('Invalid or unsupported proposal');
  if(proposal.payload.sections.near.action.calendarId!==snapshot.calendarId)throw Error('Proposal calendar does not match observation');
  if(snapshot.events.some(event=>event.id===proposal.payload.sections.near.action.event.id))throw Error('Proposed event ID already exists in the calendar');
  const latest=await get('/versions');if(!validVersions(latest))throw Error('Complete domain revisions are required');
  if(KINDS.some(kind=>versions[kind]!==latest[kind]))throw Error('Domain state changed during read; retry');
  return {student:'ana',versions,calendar:snapshot,proposal,stale:KINDS.some(kind=>proposal.versions[kind]!==versions[kind])};
}
