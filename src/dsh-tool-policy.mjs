import {createStudyBrokerClient} from './foundation/study-broker.mjs';
import {writeFileSync} from 'node:fs';

// Defense in depth for the synthetic study profile. This guards tool dispatch;
// it is not an OS sandbox or a substitute for a restricted runtime/network.
export const name='study-tool-policy';
export const inject=['tools'];
const allowed=new Set([
  'ask_user_question',
  'mcp__study__list_synthetic_files',
  'mcp__study__read_synthetic_file',
  'mcp__study__list_calendar',
  'mcp__study__draft_study_plan',
  'mcp__study__inspect_checkpoint',
  'mcp__study__routine_report',
  'mcp__study__save_report_interpretation'
]);
export function apply(ctx){
  ctx.tools.guard(execution=>allowed.has(execution.name)?undefined:'This tool is not available in the synthetic study run.');
  if(process.env.STUDY_BROKER_SOCKET){
    const broker=createStudyBrokerClient({socketPath:process.env.STUDY_BROKER_SOCKET});
    ctx.on('agent/created',({agent})=>{
      agent.ctx.tools.restrict({allow:[...allowed]});
    });
    ctx.on('agent/pre-step',async({agent},next)=>{
      const names=(agent?.ctx?.tools||ctx.tools).schemas().map(item=>item.name);
      if(names.length!==allowed.size||names.some(name=>!allowed.has(name)))throw new Error('Required synthetic study tools are unavailable');
      try {await broker.ping();}catch{throw new Error('Synthetic study broker is unavailable');}
      return next();
    });
    // Startup wiring evidence, not protection against a compromised same-UID process.
    if(process.env.STUDY_POLICY_READY)writeFileSync(process.env.STUDY_POLICY_READY,'guard-registered',{mode:0o600,flag:'wx'});
  }
}
