import {createModelBudget} from '/app/src/foundation/model-budget.mjs';
import {createOpenRouterGateway} from '/app/src/foundation/openrouter-gateway.mjs';

const budget=await createModelBudget({directory:'/tmp/model-budget'});
const student=process.env.STUDY_TEST_STUDENT;if(!['ana','bruno'].includes(student))throw new Error('Unknown synthetic persona');
let calls=0;
const server=createOpenRouterGateway({apiKey:'synthetic-provider-key',accessToken:'a'.repeat(64),budget,
  pricing:{inputPerMillion:0.3,outputPerMillion:1.2,verifiedAt:new Date().toISOString()},
  fetchImpl:async(_url,options)=>{
    calls++;const request=JSON.parse(options.body);
    const base={id:'synthetic',object:'chat.completion.chunk',created:1,model:'deepseek/deepseek-v4.1-flash-1017'};
    let chunks;
    if(calls===1){
      const allowed=new Set(['ask_user_question','mcp__study__list_synthetic_files','mcp__study__read_synthetic_file',
        'mcp__study__list_calendar','mcp__study__draft_study_plan','mcp__study__inspect_checkpoint',
        'mcp__study__routine_report','mcp__study__save_report_interpretation']);
      if(!Array.isArray(request.tools)||request.tools.some(tool=>!allowed.has(tool.function?.name)))throw new Error('Unexpected tool exposed to synthetic model');
      if(!request.tools?.some(tool=>tool.function?.name==='mcp__study__list_calendar'))throw new Error('Synthetic calendar tool missing');
      if(!request.tools.some(tool=>tool.function?.name==='mcp__study__draft_study_plan'))throw new Error('Synthetic planning tool missing');
      if(request.provider?.only?.length!==1||request.provider.only[0]!=='deepseek'||request.provider.allow_fallbacks!==false)throw new Error('Synthetic provider routing is not pinned');
      chunks=[{...base,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_calendar',type:'function',function:{name:'mcp__study__list_calendar',arguments:JSON.stringify({student})}}]},finish_reason:null}]},
        {...base,choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:10,cost:0.001}}];
    } else if(calls===2){
      if(!request.messages?.some(message=>message.role==='tool'&&JSON.stringify(message).includes('2026-11-02')))throw new Error('Synthetic broker result missing');
      chunks=[{...base,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_draft',type:'function',function:{name:'mcp__study__draft_study_plan',arguments:JSON.stringify({student,weeks:student==='ana'?4:6,hours:student==='ana'?6:5})}}]},finish_reason:null}]},
        {...base,choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:10,cost:0.001}}];
    } else if(calls===3){
      if(!request.messages?.some(message=>message.role==='tool'&&JSON.stringify(message).includes('near')))throw new Error('Synthetic draft missing');
      chunks=[{...base,choices:[{index:0,delta:{role:'assistant',content:'Synthetic container response.'},finish_reason:null}]},
        {...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,cost:0.001}}];
    } else throw new Error('Unexpected synthetic provider request');
    return new Response(chunks.map(chunk=>'data: '+JSON.stringify(chunk)+'\n\n').join('')+'data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
  }});
server.listen(8090,'0.0.0.0');
