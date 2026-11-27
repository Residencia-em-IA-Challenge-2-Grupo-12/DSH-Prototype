import {assertStudent,significant} from '../core.mjs';
import {CalendarpitApi} from './calendarpit-api.mjs';

function narrowAllowed(base, extra) {
  if (extra !== undefined && !Array.isArray(extra)) throw new Error('An explicit student allowlist is required');
  if (base === undefined) return extra;
  if (extra === undefined) return base;
  return base.filter(student => extra.includes(student));
}

// Synthetic provider adapter. The enclosing application must enforce access
// to the API and database; this module is not an authentication boundary.
export function createClaimedCalendar({origin,accessToken,getClaim,fetchImpl,transport='loopback',allowedStudents}) {
  if(typeof getClaim!=='function')throw new Error('A claim reader is required');
  if(allowedStudents!==undefined&&!Array.isArray(allowedStudents))throw new Error('An explicit student allowlist is required');
  const pinnedStudents=allowedStudents===undefined?undefined:[...allowedStudents];
  async function claimed(student,actionId,claimId) {
    assertStudent(student,pinnedStudents);
    const claim=await getClaim();
    const action=claim?.actions?.find(item=>item.actionId===actionId);
    const last=claim?.steps?.findLast(step=>step.actionId===actionId);
    if(!claim||claim.student!==student||claim.decision?.kind!=='approved'||(claimId&&claim.id!==claimId)||!action||last?.status!=='sent')throw new Error('No matching sent approval claim');
    if(action.type==='patch'?claim.kind!=='annotation':claim.kind!=='approval'||!['near','future'].includes(claim.section)||claim.decision.section!==claim.section)throw new Error('Approval claim does not match the action or section');
    return {claim,action};
  }
  const client=new CalendarpitApi({origin,accessToken,fetchImpl,transport,authorizeWrite:async(action,approval)=>{
    try {
      const {action:expected}=await claimed(approval.student,approval.actionId,approval.claimId);
      if(action.calendarId!==`${approval.student}-calendar`)return false;
      if(action.type==='create')return expected.type==='create'&&JSON.stringify(action.event)===JSON.stringify(expected.event);
      if(action.type==='delete')return expected.type==='remove'&&action.eventId===expected.event.id&&action.etag===approval.etag;
      if(action.type==='patch')return expected.type==='patch'&&action.eventId===expected.eventId&&action.etag===approval.etag&&JSON.stringify(action.changes)===JSON.stringify(expected.after);
      return false;
    } catch {return false;}
  }});
  return {
    async events(student,options) {
      assertStudent(student,narrowAllowed(pinnedStudents,options?.allowedStudents));
      const events=[],seen=new Set();let pageToken;
      do {
        const page=await client.listEvents(`${student}-calendar`,{maxResults:250,...(pageToken?{pageToken}:{})});
        if(!Array.isArray(page.items))throw new Error('Invalid synthetic calendar page');
        events.push(...page.items);
        pageToken=page.nextPageToken;
        if(pageToken){if(seen.has(pageToken)||seen.size>=100)throw new Error('Invalid or repeated calendar page token');seen.add(pageToken);}
      } while(pageToken);
      return events;
    },
    async create(student,event) {
      const actionId='create:'+event?.id;
      const {claim,action}=await claimed(student,actionId);
      if(action.type!=='create'||JSON.stringify(event)!==JSON.stringify(action.event))throw new Error('Create differs from the approval claim');
      return client.createApprovedEvent({calendarId:`${student}-calendar`,event,approval:{student,claimId:claim.id,actionId}});
    },
    async remove(student,eventId) {
      const actionId='remove:'+eventId;
      const {claim,action}=await claimed(student,actionId);
      if(action.type!=='remove'||action.event?.id!==eventId)throw new Error('Removal differs from the approval claim');
      const calendarId=`${student}-calendar`,current=await client.getEvent(calendarId,eventId);
      if(JSON.stringify(significant(current))!==JSON.stringify(significant(action.event)))throw new Error('STALE: approved event changed');
      return client.deleteApprovedEvent({calendarId,eventId,etag:current.etag,approval:{student,claimId:claim.id,actionId,etag:current.etag}});
    },
    async patch(student,eventId,changes) {
      const actionId='patch:'+eventId;
      const {claim,action}=await claimed(student,actionId);
      if(action.type!=='patch'||action.eventId!==eventId||JSON.stringify(changes)!==JSON.stringify(action.after))throw new Error('Patch differs from the approval claim');
      const calendarId=`${student}-calendar`,current=await client.getEvent(calendarId,eventId);
      if(JSON.stringify(significant(current))!==JSON.stringify(significant(action.before)))throw new Error('STALE: approved event changed');
      return client.patchApprovedEvent({calendarId,eventId,etag:current.etag,changes,approval:{student,claimId:claim.id,actionId,etag:current.etag}});
    }
  };
}
