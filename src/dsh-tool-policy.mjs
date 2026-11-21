import {createStudyBrokerClient} from './foundation/study-broker.mjs';
import {writeFileSync} from 'node:fs';
import {OPENROUTER_MODEL} from './foundation/openrouter-policy.mjs';

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
  const activeTools=new Set(allowed);
  if(process.env.STUDY_COLD_START==='1'&&process.env.STUDY_BROKER_SOCKET){
    activeTools.add('mcp__study__read_planning_context');
    activeTools.add('mcp__study__propose_planning_context');
    if(process.env.STUDY_BROWSER_COLD_START==='1')activeTools.add('mcp__study__preview_study_options');
  }
  ctx.tools.guard(execution=>activeTools.has(execution.name)?undefined:'This tool is not available in the synthetic study run.');
  if(process.env.STUDY_BROKER_SOCKET){
    const broker=createStudyBrokerClient({socketPath:process.env.STUDY_BROKER_SOCKET});
    const route=process.env.STUDY_GATEWAY_BASE_URL?
      {provider:'study-gateway',model:OPENROUTER_MODEL}:{provider:'codex',model:'gpt-6-luna'};
    ctx.on('llm/stream',(options,next)=>{
      if(options.provider!==route.provider||options.model!==route.model)throw new Error('Model route is not authorized for this synthetic run');
      return next();
    });
    ctx.on('agent/created',({agent})=>{
      agent.ctx.tools.restrict({allow:[...activeTools]});
    });
    ctx.on('agent/pre-step',async({agent},next)=>{
      const names=(agent?.ctx?.tools||ctx.tools).schemas(agent).map(item=>item.name);
      if(names.length!==activeTools.size||names.some(name=>!activeTools.has(name)))throw new Error('Required synthetic study tools are unavailable');
      try {await broker.ping();}catch{throw new Error('Synthetic study broker is unavailable');}
      return next();
    });
    // Startup wiring evidence, not protection against a compromised same-UID process.
    if(process.env.STUDY_POLICY_READY)writeFileSync(process.env.STUDY_POLICY_READY,'guard-registered',{mode:0o600,flag:'wx'});
  }
}
