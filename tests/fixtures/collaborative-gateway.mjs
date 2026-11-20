import {createModelBudget} from '/app/src/foundation/model-budget.mjs';
import {createOpenRouterGateway} from '/app/src/foundation/openrouter-gateway.mjs';
const budget=await createModelBudget({directory:'/tmp/model-budget'});let step=0;
const sequence=[
  ['mcp__study__read_synthetic_file',{student:'bruno',path:'context/preferencias.md'}],
  ['mcp__study__read_synthetic_file',{student:'bruno',path:'courses/algoritmos.md'}],
  ['mcp__study__list_calendar',{student:'bruno'}],
  ['ask_user_question',{questions:[{id:'hours',question:'For this fictional Bruno exercise, should we target five study hours per week?',options:[{label:'Five hours',description:'Use the prepared synthetic target.'}]}]}],
  ['mcp__study__draft_study_plan',{student:'bruno',weeks:6,hours:5}],
  'Scripted demonstration: a six-week proposal is ready for review. No calendar changes have been approved.',
  ['mcp__study__draft_study_plan',{student:'bruno',weeks:6,hours:5,avoidDates:['2026-11-02']}],
  'Scripted demonstration: the revised proposal leaves Monday 2 November free. Review the near-term and future sections separately.'
];
const server=createOpenRouterGateway({apiKey:'synthetic-key',accessToken:'a'.repeat(64),budget,
  pricing:{inputPerMillion:.3,outputPerMillion:1.2,verifiedAt:new Date().toISOString()},fetchImpl:async(_url,options)=>{
    const request=JSON.parse(options.body),action=sequence[step++];if(!action)throw Error('Scripted demonstration sequence is complete');
    if(Array.isArray(action)&&!request.tools?.some(tool=>tool.function.name===action[0]))throw Error('Required study tool missing');
    const base={id:'synthetic-'+step,object:'chat.completion.chunk',created:1,model:'deepseek/deepseek-v4.1-flash-1017'};
    const delta=Array.isArray(action)?{role:'assistant',tool_calls:[{index:0,id:'call_'+step,type:'function',function:{name:action[0],arguments:JSON.stringify(action[1])}}]}:{role:'assistant',content:action};
    const chunks=[{...base,choices:[{index:0,delta,finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:Array.isArray(action)?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:10,cost:.001}}];
    return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  }});
server.listen(8090,'0.0.0.0');
