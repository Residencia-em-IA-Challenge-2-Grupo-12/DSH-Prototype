import {createModelBudget} from '/app/src/foundation/model-budget.mjs';
import {createOpenRouterGateway} from '/app/src/foundation/openrouter-gateway.mjs';

const budget=await createModelBudget({directory:'/tmp/model-budget'});
const server=createOpenRouterGateway({apiKey:'synthetic-provider-key',accessToken:'a'.repeat(64),budget,
  pricing:{inputPerMillion:0.3,outputPerMillion:1.2,verifiedAt:new Date().toISOString()},
  fetchImpl:async()=>{
    const base={id:'synthetic',object:'chat.completion.chunk',created:1,model:'deepseek/deepseek-v4.1-flash-1017'};
    const chunks=[{...base,choices:[{index:0,delta:{role:'assistant',content:'Synthetic container response.'},finish_reason:null}]},
      {...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,cost:0.001}}];
    return new Response(chunks.map(chunk=>'data: '+JSON.stringify(chunk)+'\n\n').join('')+'data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
  }});
server.listen(8090,'0.0.0.0');
