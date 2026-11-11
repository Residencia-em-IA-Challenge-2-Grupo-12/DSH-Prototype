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
export function apply(ctx){ctx.tools.guard(execution=>allowed.has(execution.name)?undefined:'This tool is not available in the synthetic study run.');}
