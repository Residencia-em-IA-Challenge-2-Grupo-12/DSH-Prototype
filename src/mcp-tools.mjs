import {z} from 'zod';
import {availabilityOptions} from './foundation/availability-preview.mjs';
import {planningContextSchema} from './cold-start-context.mjs';

// Identical tool schemas for the legacy local entry point and the isolated
// broker entry point. Authorization belongs to the supplied trusted boundary.
export function registerStudyTools(server,call,{coldStart=false,browserStudy=false}={}){
  const student=z.enum(['ana','bruno']);
  const safe=method=>async args=>{try{return {content:[{type:'text',text:JSON.stringify(await call(method,args),null,2)}]};}catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}};
  server.registerTool('list_synthetic_files',{description:'List files within a selected synthetic student workspace.',inputSchema:{student,path:z.string().optional()}},safe('list_synthetic_files'));
  server.registerTool('read_synthetic_file',{description:'Read a text or PDF syllabus or preference file from the selected synthetic workspace.',inputSchema:{student,path:z.string()}},safe('read_synthetic_file'));
  server.registerTool('list_calendar',{description:'Read the synthetic calendar. Simulation today is 2026-11-02 in America/Sao_Paulo; interpret dates relative to that date, not the host clock. No real accounts are connected.',inputSchema:{student}},safe('list_calendar'));
  const draftInputs={
    student, weeks:z.number().int().min(1).max(16).optional(),
    avoidDates:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(112).optional(),
    preferredPeriod:z.enum(['morning','afternoon','evening']).optional(),
    focusCourse:z.string().max(200).optional(),
  };
  const targetInput=coldStart
    ? 'Uses the already confirmed hours per week for every week. Change those hours through a new reviewed context.'
    : 'Hours are the target per week and must be a whole number.';
  server.registerTool('draft_study_plan',{
    description:`Create or revise a reviewable plan in one-hour blocks. ${targetInput} Use avoidDates for specified dates off, preferredPeriod as a soft preference and focusCourse only when explicitly requested. ${coldStart?'Use course-coverage only to show a requested alternative that gives uncovered courses a feasible first block. Omit focusCourse for that alternative. ':''}The human separately approves any calendar changes.`,
    inputSchema:{...draftInputs,...(coldStart
      ? {allocation:z.enum(['course-coverage']).optional()}
      : {hours:z.number().int().min(0).max(20).optional()})},
  },safe('draft_study_plan'));
  if(coldStart){
    if(browserStudy)server.registerTool('preview_study_options',{
      description:'Check concrete windows against commitments before offering them in a native question. Batches combine by exact label for one question. An empty conflicts list means the window is clear; null means calendar unavailable. A window can start exactly when an event ends.',
      inputSchema:{student,options:availabilityOptions},},safe('preview_study_options'));
    server.registerTool('read_planning_context',{description:'Read the pending and operator-confirmed cold-start context. Reuse confirmed answers within their scope.',inputSchema:{student}},safe('read_planning_context'));
    server.registerTool('propose_planning_context',{description:'Submit normalized deadlines and planning preferences for separate operator review. Quote the authoritative document verbatim and give PDF pages. For conflicting sources, record the operator’s resolution. Use weekdays 0 (Sunday) through 6 (Saturday). Agree on time windows, target, daily limit, break, and expiry. Include important assumptions. Produces a pending record only.',inputSchema:{student,record:planningContextSchema}},safe('propose_planning_context'));
  }
  server.registerTool('inspect_checkpoint',{description:'Compare the current synthetic calendar with the last saved snapshot; preserve user edits.',inputSchema:{student,reason:z.string().optional()}},safe('inspect_checkpoint'));
  server.registerTool('routine_report',{description:'Calculate routine metrics from the synthetic calendar and optional user feedback; scheduled time is not evidence of completion.',inputSchema:{student}},safe('routine_report'));
  server.registerTool('save_report_interpretation',{description:'Save your source-grounded, non-diagnostic explanation of routine_report metrics. State uncertainty and never infer completion from scheduled time.',inputSchema:{student,narrative:z.string().max(12000)}},safe('save_report_interpretation'));
}
