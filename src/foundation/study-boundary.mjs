import {assertStudent,FIXED_TODAY,listWorkspace,readWorkspace,draft,checkpoint,report,saveNarrative,readPlanningContext,proposePlanningContext} from '../core.mjs';

// Trusted application side of a single synthetic run. It deliberately exposes
// no approval, reset, raw provider, administration or calendar-write method.
export function createStudyBoundary({student,calendar,requireStaged=true,coldStart=false,availabilityPreview}={}){
  assertStudent(student);
  if(typeof requireStaged!=='boolean')throw new Error('Workspace policy must be explicit');
  if(!calendar||typeof calendar.events!=='function')throw new Error('A synthetic calendar is required');
  const methods=new Map([
    ['list_synthetic_files',a=>listWorkspace(student,a.path||'',{requireStaged})],
    ['read_synthetic_file',a=>readWorkspace(student,a.path,{requireStaged})],
    ['list_calendar',async()=>({simulationToday:FIXED_TODAY,timezone:'America/Sao_Paulo',events:await calendar.events(student)})],
    ['draft_study_plan',a=>draft(calendar,student,{weeks:a.weeks,hours:a.hours,avoidDates:a.avoidDates,preferredPeriod:a.preferredPeriod,focusCourse:a.focusCourse,...(coldStart?{allocation:a.allocation}:{})},{requireStaged})],
    ['inspect_checkpoint',a=>checkpoint(calendar,student,a.reason||'')],
    ['routine_report',()=>report(calendar,student)],
    ['save_report_interpretation',a=>saveNarrative(student,a.narrative)]
  ]);
  if(coldStart){
    if(availabilityPreview)methods.set('preview_study_options',args=>availabilityPreview.stage(args.options));
    methods.set('read_planning_context',()=>readPlanningContext(student));
    methods.set('propose_planning_context',args=>proposePlanningContext(student,args.record));
  }
  return {
    methods:()=>[...methods.keys()],
    async call(method,args){
      if(!methods.has(method))throw new Error('Agent operation is not available');
      if(!args||typeof args!=='object'||Array.isArray(args)||args.student!==student)throw new Error('Request does not match the selected synthetic student');
      return methods.get(method)(args);
    },
  };
}
