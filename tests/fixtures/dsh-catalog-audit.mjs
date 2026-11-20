import {writeFile} from 'node:fs/promises';
export const name='study-test-catalog-audit';
export const inject=['tools'];
export function apply(ctx){
  const timer=setInterval(()=>{
    const names=ctx.tools.schemas().map(item=>item.name).sort();
    const denial=ctx.tools.checkGuards({name:'bash'});
    const studyDenial=ctx.tools.checkGuards({name:'mcp__study__list_calendar'});
    void writeFile(process.env.STUDY_TOOL_AUDIT_FILE,JSON.stringify({names,denial,studyDenial:studyDenial??null})).catch(()=>{});
  },100);
  timer.unref();
  ctx.on('dispose',()=>clearInterval(timer));
}
