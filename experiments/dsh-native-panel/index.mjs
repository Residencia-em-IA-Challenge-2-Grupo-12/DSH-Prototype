import {TypertRemoteService,Remote} from '@deepseek-ai/dsh-typert-protocol';
import {hostContribution} from './panel-descriptor.mjs';
import {panelData} from './panel-view.mjs';
let marker;Remote('view')(undefined,{kind:'method',name:'view',private:false,static:false,addInitializer(fn){marker=fn;}});
export class PanelHost extends TypertRemoteService {
 constructor(ctx,config){
  super(ctx,'calendarSpike');marker.call(this);
  let u;try{u=new URL(config.origin)}catch{throw Error('A loopback origin is required')}
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('A loopback origin is required');
  if(typeof config.proposalId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(config.proposalId))throw Error('Synthetic proposal is required');
  this.origin=u.origin;this.selected=config.proposalId;
  this.fetchImpl=config.fetchImpl||globalThis.fetch;
  if(typeof this.fetchImpl!=='function')throw Error('Fetch implementation is required');
 }
 async view(){
  const root=this.origin+'/v1/students/ana';
  const get=async suffix=>{const response=await this.fetchImpl(root+suffix,{redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Domain read failed (HTTP '+response.status+')');return response.json();};
  const kinds=['calendar','context','evidence'];
  const validVersions=value=>value&&typeof value==='object'&&kinds.every(kind=>Number.isSafeInteger(value[kind])&&value[kind]>0);
  const versions=await get('/versions');if(!validVersions(versions))throw Error('Complete domain revisions are required');
  const [calendar,proposal]=await Promise.all([get('/revisions/calendar/'+versions.calendar),get('/proposals/'+this.selected)]);
  if(calendar?.student!=='ana'||calendar.kind!=='calendar'||calendar.version!==versions.calendar||!calendar.payload||typeof calendar.payload!=='object'||Array.isArray(calendar.payload))throw Error('Invalid calendar revision identity');
  if(proposal?.student!=='ana'||proposal.id!==this.selected||!validVersions(proposal.versions))throw Error('Invalid proposal identity or revisions');
  const latest=await get('/versions');if(!validVersions(latest))throw Error('Complete domain revisions are required');
  if(kinds.some(kind=>versions[kind]!==latest[kind]))throw Error('Domain state changed during read; retry');
  const stale=kinds.some(kind=>proposal.versions[kind]!==versions[kind]);
  const result={student:'ana',versions,calendar:calendar.payload,proposal,stale};
  panelData(result); // Reject unrecognized proposal schemas rather than showing no blocks.
  return result;
 }
}
export const inject=['typert'];
export function apply(ctx){
 ctx.plugin(PanelHost,{origin:process.env.STUDY_PANEL_ORIGIN,proposalId:process.env.STUDY_PANEL_PROPOSAL});
 ctx.effect(()=>ctx.typert.register(hostContribution),'study-panel: descriptor');
}
