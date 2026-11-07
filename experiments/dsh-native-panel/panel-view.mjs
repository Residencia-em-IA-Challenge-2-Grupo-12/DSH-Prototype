// Narrow, read-only adapter for the common consumer's single-create proposal.
// Unknown proposal shapes must not be displayed as though they were empty.
const ZONE='America/Sao_Paulo';
const WEEK_START=Date.parse('2026-11-02T00:00:00-03:00');
const WEEK_END=Date.parse('2026-11-09T00:00:00-03:00');
const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function validDate(year,month,day){
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return month>=1&&month<=12&&day>=1&&day<=days[month-1];
}
function instant(value){
  if(typeof value!=='string')return null;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!m)return null;
  const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
  if(!validDate(year,month,day)||hour>23||minute>59||(m[6]!==undefined&&second>59))return null;
  if(m[8]!=='Z'){
    const offsetHours=Number(m[8].slice(1,3)),offsetMinutes=Number(m[8].slice(4,6));
    if(offsetHours>14||offsetMinutes>59||(offsetHours===14&&offsetMinutes!==0))return null;
  }
  const result=Date.parse(value);return Number.isFinite(result)?result:null;
}
function allDayDate(value){
  if(typeof value!=='string')return null;
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(!m||!validDate(Number(m[1]),Number(m[2]),Number(m[3])))return null;
  return value;
}
function validExisting(event){
  if(!event||typeof event!=='object'||Array.isArray(event)||typeof event.id!=='string'||!event.id||typeof event.summary!=='string')return false;
  const start=event.start,end=event.end;
  if(!start||!end||typeof start!=='object'||typeof end!=='object'||Array.isArray(start)||Array.isArray(end))return false;
  if('dateTime' in start||'dateTime' in end){
    if('date' in start||'date' in end)return false;
    const a=instant(start.dateTime),b=instant(end.dateTime);return a!==null&&b!==null&&b>a;
  }
  const a=allDayDate(start.date),b=allDayDate(end.date);return a!==null&&b!==null&&b>a;
}

// This spike covers the fixed synthetic 2–8 November 2026 São Paulo week.
export function weekTime(value) {
  const timestamp=instant(value);if(timestamp===null)return null;
  const parts=Object.fromEntries(formatter.formatToParts(timestamp).map(part=>[part.type,part.value]));
  const year=Number(parts.year),month=Number(parts.month),day=Number(parts.day),hour=Number(parts.hour),minute=Number(parts.minute);
  if(year!==2026||month!==11||day<2||day>8||hour>23||minute>59)return null;
  return {day:day-2,hour:hour+minute/60};
}
export function placement(event) {
  const start=weekTime(event.start?.dateTime),end=weekTime(event.end?.dateTime);
  if(!start||!end||start.day!==end.day||end.hour<=start.hour)return null;
  return {day:start.day,top:start.hour*20,height:(end.hour-start.hour)*20};
}
export function panelData(payload) {
  const calendar=payload?.calendar;
  if(!calendar||typeof calendar!=='object'||Array.isArray(calendar)||typeof calendar.calendarId!=='string'||!calendar.calendarId||calendar.timeZone!==ZONE||instant(calendar.timeMin)!==WEEK_START||instant(calendar.timeMax)!==WEEK_END||!Array.isArray(calendar.events)||calendar.events.some(event=>!validExisting(event)))throw new Error('Unsupported calendar observation');
  const proposal=payload?.proposal?.payload;
  const sections=proposal?.sections;
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal)||Object.keys(proposal).some(key=>!['sections','sources','assumptions'].includes(key)))throw new Error('Unsupported proposal schema');
  if(!sections||typeof sections!=='object'||Array.isArray(sections)||Object.keys(sections).some(key=>key!=='near'))throw new Error('Unsupported proposal schema');
  const near=sections.near;
  if(!near||typeof near!=='object'||Array.isArray(near)||Object.keys(near).some(key=>key!=='action'))throw new Error('Unsupported proposal section');
  const action=near.action;
  if(!action||action.type!=='create'||typeof action.calendarId!=='string'||!action.calendarId||action.calendarId!==calendar.calendarId||Object.keys(action).some(key=>!['type','calendarId','event'].includes(key)))throw new Error('Unsupported proposal action or calendar');
  const event=action.event;
  if(!validExisting(event)||typeof event.start.dateTime!=='string'||typeof event.end.dateTime!=='string'||!placement(event))throw new Error('Unsupported proposed event or time');
  return {events:[...calendar.events.map(item=>({...item,kind:'existing'})),{...event,kind:'add'}],proposedCount:1};
}
