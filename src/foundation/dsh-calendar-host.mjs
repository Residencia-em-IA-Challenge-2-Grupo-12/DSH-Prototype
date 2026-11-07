// Synthetic-only feasibility spike. Never expose this unauthenticated service to agents.
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
let marker;
Remote('read')(undefined,{kind:'method',name:'read',private:false,static:false,addInitializer(fn){marker=fn;}});

export class CalendarHost extends TypertRemoteService {
  constructor(ctx,config) {
    super(ctx,'calendarSpike'); marker.call(this);
    let u; try { u=new URL(config?.origin); } catch { throw Error('A loopback origin is required'); }
    if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('A loopback origin is required');
    this.origin=u.origin;
    this.fetchImpl=config.fetchImpl||globalThis.fetch;
    if(typeof this.fetchImpl!=='function')throw Error('Fetch implementation is required');
    if(!Array.isArray(config.students)||!config.students.length||config.students.some(s=>typeof s!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(s)))throw Error('Synthetic student allowlist is required');
    this.students=new Set(config.students);
  }
  async read(student,proposalId) {
    if(typeof student!=='string'||!this.students.has(student))throw Error('Unknown synthetic student');
    if(typeof proposalId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(proposalId))throw Error('Invalid proposal');
    const root=`${this.origin}/v1/students/${student}`;
    const get=async suffix=>{
      const response=await this.fetchImpl(root+suffix,{redirect:'error',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('Domain read failed (HTTP '+response.status+')');
      return response.json();
    };
    const validVersions=value=>value&&typeof value==='object'&&['calendar','context','evidence'].every(kind=>Number.isSafeInteger(value[kind])&&value[kind]>0);
    const versions=await get('/versions');
    if(!validVersions(versions))throw Error('Complete domain revisions are required');
    const [calendar,proposal]=await Promise.all([get('/revisions/calendar/'+versions.calendar),get('/proposals/'+proposalId)]);
    if(calendar?.student!==student||calendar.kind!=='calendar'||calendar.version!==versions.calendar||!calendar.payload||typeof calendar.payload!=='object'||Array.isArray(calendar.payload))throw Error('Invalid calendar revision identity');
    if(proposal?.student!==student||proposal.id!==proposalId||!validVersions(proposal.versions))throw Error('Invalid proposal identity or revisions');
    const latest=await get('/versions');
    if(!validVersions(latest))throw Error('Complete domain revisions are required');
    if(['calendar','context','evidence'].some(kind=>versions[kind]!==latest[kind]))throw Error('Domain state changed during read; retry');
    const stale=['calendar','context','evidence'].some(kind=>proposal.versions[kind]!==versions[kind]);
    return {student,versions,calendar:calendar.payload,proposal,stale};
  }
}
