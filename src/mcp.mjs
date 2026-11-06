import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Calendarpit, FIXED_TODAY, listWorkspace, readWorkspace, draft, report, checkpoint, saveNarrative } from './core.mjs';

const server=new McpServer({name:'synthetic-study-demo',version:'0.1.0'});
const student=z.enum(['ana','bruno']);
const ok=(data)=>({content:[{type:'text',text:JSON.stringify(data,null,2)}]});
const safe=(fn)=>async args=>{try{return ok(await fn(args));}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}};
server.registerTool('list_synthetic_files',{description:'List files within a selected synthetic student workspace.',inputSchema:{student,path:z.string().optional()}},safe(a=>listWorkspace(a.student,a.path||'')));
server.registerTool('read_synthetic_file',{description:'Read a text or PDF syllabus or preference file from the selected synthetic workspace.',inputSchema:{student,path:z.string()}},safe(a=>readWorkspace(a.student,a.path)));
server.registerTool('list_calendar',{description:'Read the synthetic calendar. Simulation today is 2026-11-02 in America/Sao_Paulo; interpret dates relative to that date, not the host clock. No real accounts are connected.',inputSchema:{student}},safe(async a=>({simulationToday:FIXED_TODAY,timezone:'America/Sao_Paulo',events:await new Calendarpit().events(a.student)})));
server.registerTool('draft_study_plan',{description:'Create or revise a reviewable study plan without writing calendar events. Hours must be whole numbers and blocks are one hour. Use avoidDates for specific dates the user wants free and preferredPeriod for a morning or afternoon preference; the other period can be used as a fallback. In this simulation today is 2026-11-02, not the host date. The human must approve each section in the companion UI.',inputSchema:{student,weeks:z.number().int().min(1).max(16).optional(),hours:z.number().int().min(0).max(20).optional(),avoidDates:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(112).optional(),preferredPeriod:z.enum(['morning','afternoon']).optional()}},safe(a=>draft(new Calendarpit(),a.student,{weeks:a.weeks,hours:a.hours,avoidDates:a.avoidDates,preferredPeriod:a.preferredPeriod})));
server.registerTool('inspect_checkpoint',{description:'Compare the current synthetic calendar with the last saved snapshot; preserve user edits.',inputSchema:{student,reason:z.string().optional()}},safe(a=>checkpoint(new Calendarpit(),a.student,a.reason||'')));
server.registerTool('routine_report',{description:'Calculate routine metrics from the synthetic calendar and optional user feedback; scheduled time is not evidence of completion.',inputSchema:{student}},safe(a=>report(new Calendarpit(),a.student)));
server.registerTool('save_report_interpretation',{description:'Save your source-grounded, non-diagnostic explanation of routine_report metrics. State uncertainty and never infer completion from scheduled time.',inputSchema:{student,narrative:z.string().max(12000)}},safe(a=>saveNarrative(a.student,a.narrative)));
await server.connect(new StdioServerTransport());
