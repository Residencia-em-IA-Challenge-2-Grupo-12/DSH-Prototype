// Narrow, read-only adapter for the common consumer's single-create proposal.
// Unknown proposal shapes must not be displayed as though they were empty.
export function panelData(payload) {
  if (!Array.isArray(payload?.calendar?.events)) throw new Error('Unsupported calendar schema');
  const proposal=payload?.proposal?.payload;
  const sections=proposal?.sections;
  if (!proposal || typeof proposal!=='object' || Array.isArray(proposal) || Object.keys(proposal).some(key=>!['sections','sources','assumptions'].includes(key))) throw new Error('Unsupported proposal schema');
  if (!sections || typeof sections!=='object' || Array.isArray(sections) || Object.keys(sections).some(key=>key!=='near')) throw new Error('Unsupported proposal schema');
  const action=sections.near?.action;
  if (!action || action.type!=='create' || typeof action.calendarId!=='string' || !action.calendarId || Object.keys(action).some(key=>!['type','calendarId','event'].includes(key))) throw new Error('Unsupported proposal action');
  const event=action.event;
  if (!event || typeof event!=='object' || Array.isArray(event) || typeof event.id!=='string' || !event.id || typeof event.summary!=='string' || typeof event.start?.dateTime!=='string' || typeof event.end?.dateTime!=='string') throw new Error('Unsupported proposal event');
  return {events:[...payload.calendar.events.map(item=>({...item,kind:'existing'})),{...event,kind:'add'}],proposedCount:1};
}

// This spike covers the fixed synthetic 2–8 November 2026 São Paulo week.
export function weekTime(value) {
  if(typeof value!=='string')return null;
  const match=/^(2026-11-0[2-8])T(\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?-03:00$/.exec(value);
  if(!match)return null;
  const hours=Number(match[2]),minutes=Number(match[3]);
  if(hours>23||minutes>59)return null;
  return {day:Number(match[1].slice(-2))-2,hour:hours+minutes/60};
}
export function placement(event) {
  const start=weekTime(event.start?.dateTime),end=weekTime(event.end?.dateTime);
  if(!start||!end||start.day!==end.day||end.hour<=start.hour)return null;
  return {day:start.day,top:start.hour*20,height:(end.hour-start.hour)*20};
}
