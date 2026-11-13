import {writeFile} from 'node:fs/promises';
import {scopeTarget} from '@deepseek-ai/dsh-scope';

// Test-only plugin: create an agent through DSH's public factory, never prompt it.
export const name='study-subscription-catalog-audit';
export const inject=['agents','tools','llm'];
export function apply(ctx){
  let started=false,handle,modelAttempts=0;
  ctx.on('llm/stream',()=>{modelAttempts++;throw Error('Catalog audit forbids generative calls');});
  const timer=setInterval(async()=>{
    if(started)return;
    const globalNames=ctx.tools.schemas().map(item=>item.name).sort();
    if(!globalNames.includes('image_generate')||!globalNames.includes('mcp__study__list_calendar'))return;
    started=true;
    try{
      handle=await ctx.agents.create({sessionId:'synthetic-catalog-audit',meta:{cwd:process.cwd()},agentOptions:{provider:'codex',model:'gpt-6-luna'}});
      const agent=handle.agent,tools=agent.ctx.tools;
      let preStepPassed=false,preStepError=null;
      try{await ctx.waterfall(scopeTarget(agent,agent),'agent/pre-step',{agent,messages:[],turn:1,step:1,signal:new AbortController().signal,modelSelection:agent.model.current()},()=>Promise.resolve({kind:'enter',messages:[]}));preStepPassed=true;}catch(error){preStepError=error.message;}
      await writeFile(process.env.STUDY_TOOL_AUDIT_FILE,JSON.stringify({
        globalNames,preStepPassed,preStepError,modelAttempts,names:tools.schemas(agent).map(item=>item.name).sort(),
        model:handle.agent.model.current(),
        denials:Object.fromEntries(['bash','image_generate','mcp__study__approve','unknown_tool'].map(name=>[name,tools.checkGuards({name})??null])),
        studyDenial:tools.checkGuards({name:'mcp__study__list_calendar'})??null
      }),{mode:0o600});
    }catch{await writeFile(process.env.STUDY_TOOL_AUDIT_FILE,JSON.stringify({error:'Agent catalog creation failed'}),{mode:0o600});}
  },100);
  timer.unref();
  ctx.on('dispose',()=>{clearInterval(timer);return handle?.dispose();});
}
