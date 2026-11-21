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
  server.registerTool('draft_study_plan',{description:'Create or revise a reviewable study plan without writing calendar events. Hours must be whole numbers and blocks are one hour. Use avoidDates for specific dates the user wants free and preferredPeriod for a morning, afternoon, or evening preference; other stated windows can be used as a fallback. Use focusCourse only when the user chooses a course to prioritize; the heuristic reserves two out of three candidate blocks for that course when feasible; the horizon remains capped at the nearest deadline. Study blocks are limited to the student’s stated windows, daily limit and study break; an empty calendar does not imply availability. Simulation today is 2026-11-02. The human must approve each section in the companion UI.',inputSchema:{student,weeks:z.number().int().min(1).max(16).optional(),hours:z.number().int().min(0).max(20).optional(),avoidDates:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(112).optional(),preferredPeriod:z.enum(['morning','afternoon','evening']).optional(),focusCourse:z.string().max(200).optional()}},safe('draft_study_plan'));
  if(coldStart){
    if(browserStudy)server.registerTool('preview_study_options',{
      description:'Preview the concrete calendar windows offered in your next native question. Use exact option labels, one local date and time range per window. This is a preview only.',
      inputSchema:{student,options:availabilityOptions},},safe('preview_study_options'));
    server.registerTool('read_planning_context',{description:'Read the pending and operator-confirmed cold-start context. Reuse confirmed answers within their scope.',inputSchema:{student}},safe('read_planning_context'));
    server.registerTool('propose_planning_context',{description:'Submit normalized deadlines and planning preferences for separate operator review. Quote the authoritative document verbatim and give PDF pages. For conflicting sources, record the operator’s resolution. Use weekdays 0 (Sunday) through 6 (Saturday). Agree on time windows, target, daily limit, break, and expiry. Include important assumptions. Produces a pending record only.',inputSchema:{student,record:planningContextSchema}},safe('propose_planning_context'));
  }
  server.registerTool('inspect_checkpoint',{description:'Compare the current synthetic calendar with the last saved snapshot; preserve user edits.',inputSchema:{student,reason:z.string().optional()}},safe('inspect_checkpoint'));
  server.registerTool('routine_report',{description:'Calculate routine metrics from the synthetic calendar and optional user feedback; scheduled time is not evidence of completion.',inputSchema:{student}},safe('routine_report'));
  server.registerTool('save_report_interpretation',{description:'Save your source-grounded, non-diagnostic explanation of routine_report metrics. State uncertainty and never infer completion from scheduled time.',inputSchema:{student,narrative:z.string().max(12000)}},safe('save_report_interpretation'));
}
