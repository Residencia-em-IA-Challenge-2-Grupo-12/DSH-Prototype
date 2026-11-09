// SDK probe plugin: host-trusted code; fixture data only, no model request.
import { createRequire } from 'node:module';
import { writeFile, rename } from 'node:fs/promises';
import { runSyntheticWorker } from '../worker.mjs';
const req=createRequire(process.cwd()+'/package.json');
const {defineTool}=await import(req.resolve('@deepseek-ai/dsh-tools'));
export const inject=['tools'];
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name:'synthetic_bash',description:'Run Bash on a disposable fictional workspace. Write the result to /output/result.txt.',
    parameters:{script:{type:'string',required:true,description:'Bounded Bash script for fictional inputs only.'}},
    output:{schema:{type:'object',additionalProperties:false,properties:{artifact:{type:'string',required:true},stdout:{type:'string',required:true},stderr:{type:'string',required:true}}},
      render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute({script},exec) {
      const result=await runSyntheticWorker({image:process.env.SYNTHETIC_WORKER_TEST_IMAGE,files:{'course.txt':'fictional syllabus\n'},script,timeoutMs:5000,signal:exec.signal});
      return {artifact:result.artifact.toString('utf8'),stdout:result.stdout,stderr:result.stderr};
    },
  }));
  const timer=setTimeout(async()=>{
    const report={catalog:ctx.tools.schemas().map(tool=>tool.name).sort()};
    try {
      const quote=value=>`'${String(value).replaceAll("'", "'\\''")}'`;
      const canary=quote(process.env.STUDY_WORKER_HOST_CANARY);
      const script=`set -eu\n[[ $EUID -eq 65534 ]]\n[[ ! -e /var/run/docker.sock ]]\n[[ ! -e ${canary} ]]\nif ( printf x > /dev/tcp/1.1.1.1/53 ) 2>/dev/null; then exit 5; fi\nread -r line < /workspace/course.txt\nprintf "%s" "$line" > /output/result.txt`;
      const denied=['bash','read','read_file','write','edit','working_directory','run_code','shell','bash_persistent'];
      const calls=[{type:'tool-call',id:'worker',name:'synthetic_bash',arguments:JSON.stringify({script})},
        ...denied.map((name,index)=>({type:'tool-call',id:`denied-${index}`,name,arguments:'{}'}))];
      report.batch=await ctx.tools.execute({calls,signal:new AbortController().signal});
      if(process.env.SYNTHETIC_WORKER_TEST_IMAGE){
        const aborter=new AbortController();
        const abortTimer=setTimeout(()=>aborter.abort(),1500);
        try {
          report.cancel=await ctx.tools.execute({calls:[{type:'tool-call',id:'cancel-worker',name:'synthetic_bash',arguments:JSON.stringify({script:'while :; do :; done'})}],signal:aborter.signal});
        } finally {clearTimeout(abortTimer);}
      }
    } catch(error) {report.error={name:error.name,message:error.message};}
    const destination=process.env.STUDY_WORKER_PROBE_REPORT;
    await writeFile(destination+'.tmp',JSON.stringify(report,null,2),{mode:0o600});
    await rename(destination+'.tmp',destination);
  },1500);
  ctx.effect(()=>()=>clearTimeout(timer),'worker-spike: diagnostic');
}
