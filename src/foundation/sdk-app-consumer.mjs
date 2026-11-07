// Deterministic synthetic SDK-host-style experiment. No DSH session is attached.
import { makePlan } from '../core.mjs';
import { observeCalendar } from './calendar-domain-observer.mjs';
import { applyApprovedCreate } from './calendar-approved-create.mjs';

/** Keep `human` in the trusted host. `agent` contains no decision or write method.
 * This split is an interface experiment, not a sandbox or authentication boundary.
 */
export async function createSyntheticConsumer({domain,provider,student,profile,origin,accessToken,fetchImpl}) {
  if(student!=='ana'||profile?.student!==student)throw new Error('Only the ana synthetic fixture is supported');
  if(profile.timezone!=='America/Sao_Paulo')throw new Error('Unexpected synthetic timezone');
  const current=await domain.currentVersions(student);
  if(current.context||current.evidence||current.calendar)throw new Error('A fresh synthetic domain is required');
  const context={synthetic:true,profile:structuredClone(profile)};
  await domain.request(student,'revisions/context',{expectedVersion:0,payload:context});
  await domain.request(student,'revisions/evidence',{expectedVersion:0,payload:{synthetic:true,sources:[]}});
  const calendarId='ana-calendar',timeMin='2026-11-02T00:00:00-03:00',timeMax='2026-11-09T00:00:00-03:00';
  const profileAt=async version=>{
    const revision=await domain.request(student,`revisions/context/${version}`);
    const stored=revision?.payload?.profile;
    if(revision?.payload?.synthetic!==true||stored?.student!==student||stored.timezone!=='America/Sao_Paulo')throw new Error('Invalid synthetic context revision');
    return stored;
  };

  const agent=Object.freeze({
    async readContext(){
      const versions=await domain.currentVersions(student);
      return (await domain.request(student,`revisions/context/${versions.context}`)).payload;
    },
    async readCalendar(){
      const versions=await domain.currentVersions(student),stored=await profileAt(versions.context);
      return observeCalendar({provider,store:domain,student,calendarId,timeMin,timeMax,timeZone:stored.timezone});
    },
    async draftOneBlock(){
      const versions=await domain.currentVersions(student);
      if(!versions.calendar)throw new Error('Read the synthetic calendar first');
      const stored=await profileAt(versions.context);
      const snapshot=(await domain.calendarRevision(student,versions.calendar)).payload;
      // This consumer creates one event and does not remove older study events.
      const candidate=makePlan(stored,snapshot.events,{weeks:1,hours:1,protectedIds:snapshot.events.map(event=>event.id)}).near[0];
      if(!candidate)throw new Error('No block is available in the stated study windows');
      const action={type:'create',calendarId,event:candidate};
      const proposal=await domain.request(student,'proposals',{versions,payload:{sections:{near:{action}},
        assumptions:['Synthetic fixture; one heuristic block, not a complete plan.'],sources:stored.courses.map(c=>c.source)}});
      return proposal;
    }
  });
  const human=Object.freeze({
    async reject(proposalId){return domain.request(student,`proposals/${encodeURIComponent(proposalId)}/decisions`,{section:'near',choice:'reject'});},
    async approveAndApply(proposalId,confirmation){
      if(confirmation!=='APPROVE')throw new Error('Explicit APPROVE confirmation required');
      const proposal=await domain.proposal(student,proposalId);
      const action=proposal.payload?.sections?.near?.action;
      if(!action)throw new Error('Reviewable action missing');
      await domain.request(student,`proposals/${encodeURIComponent(proposalId)}/decisions`,{section:'near',choice:'approve'});
      return applyApprovedCreate({domain,student,proposalId,section:'near',action,origin,accessToken,...(fetchImpl?{fetchImpl}:{})});
    }
  });
  return {agent,human};
}
