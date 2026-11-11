import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const docker=async(...args)=>(await exec('docker',args,{timeout:20000,maxBuffer:64000})).stdout.trim();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validate(runId,lease){
  if(typeof runId!=='string'||!uuid.test(runId))throw new Error('A reserved synthetic run ID is required');
  if(typeof lease?.assertHeld!=='function')throw new Error('An exclusive controller lease is required');
  lease.assertHeld();
}

// Absence is established only by a successful daemon query. A daemon error,
// competing name or mismatched label is unknown, never successful retirement.
async function inspectContainer({runId,lease,runDocker=docker,kind}){
  validate(runId,lease);const name=`study-${kind}-${runId}`;let listed;
  try{listed=await runDocker('ps','-a','--filter',`name=^/${name}$`,'--format','{{.ID}}');}
  catch(error){throw new Error(`Synthetic ${kind} inspection failed; resource state is unknown`,{cause:error});}
  const ids=listed.trim()?listed.trim().split(/\s+/):[];
  if(ids.length>1||ids.some(id=>!/^[a-f0-9]{12,64}$/.test(id)))throw new Error(`Synthetic ${kind} identity is ambiguous`);
  if(!ids.length){lease.assertHeld();return {state:'absent'};}
  let observed;
  try{observed=JSON.parse(await runDocker('inspect','--format','{{json .}}',ids[0]));}
  catch(error){throw new Error(`Synthetic ${kind} inspection failed; resource state is unknown`,{cause:error});}
  if(!/^[a-f0-9]{64}$/.test(observed?.Id||'')||!observed.Id.startsWith(ids[0])||observed.Name!==`/${name}`||
    observed.Config?.Labels?.['study.run.id']!==runId||typeof observed.State?.Running!=='boolean')throw new Error(`Synthetic ${kind} resource identity does not match the run`);
  lease.assertHeld();return {state:observed.State.Running?'running':'stopped',id:observed.Id};
}
export const inspectDockerAgent=options=>inspectContainer({...options,kind:'agent'});
export const inspectDockerCalendar=options=>inspectContainer({...options,kind:'calendar'});

// This controls only the named synthetic container. Trusted calendar writers
// and delayed provider effects must be drained or marked uncertain separately.
async function retireContainer({runId,lease,runDocker=docker,force=false,kind}){
  if(typeof force!=='boolean')throw new Error('Force must be an explicit boolean');
  const inspect=()=>inspectContainer({runId,lease,runDocker,kind});
  const original=await inspect();if(original.state==='absent')return original;
  if(original.state==='running'){
    lease.assertHeld();
    try{await runDocker(...(force?['kill',original.id]:['stop','--time','10',original.id]));}
    catch(error){
      const current=await inspect();
      if(current.state==='absent')return current;
      throw new Error(`Synthetic ${kind} stop could not be verified`,{cause:error});
    }
  }
  const stopped=await inspect();if(stopped.state==='absent')return stopped;
  if(stopped.id!==original.id||stopped.state!=='stopped')throw new Error(`Synthetic ${kind} changed or is still running`);
  lease.assertHeld();
  try{await runDocker('rm',original.id);}catch(error){
    const current=await inspect();if(current.state==='absent')return current;
    throw new Error(`Synthetic ${kind} removal could not be verified`,{cause:error});
  }
  const result=await inspect();
  if(result.state!=='absent')throw new Error(`Synthetic ${kind} retirement could not be verified`);
  return result;
}
export const retireDockerAgent=options=>retireContainer({...options,kind:'agent'});
export const retireDockerCalendar=options=>retireContainer({...options,kind:'calendar'});

export async function inspectDockerNetwork({runId,kind,lease,runDocker=docker}={}){
  validate(runId,lease);if(!['agent','calendar'].includes(kind))throw new Error('Unknown synthetic network kind');
  const name=`study-${kind}-net-${runId}`;let listed;
  try{listed=await runDocker('network','ls','--filter',`name=^${name}$`,'--format','{{.ID}}');}
  catch(error){throw new Error('Synthetic network inspection failed; resource state is unknown',{cause:error});}
  const ids=listed.trim()?listed.trim().split(/\s+/):[];
  if(ids.length>1||ids.some(id=>!/^[a-f0-9]{12,64}$/.test(id)))throw new Error('Synthetic network identity is ambiguous');
  if(!ids.length){lease.assertHeld();return {state:'absent'};}
  let observed;try{observed=JSON.parse(await runDocker('network','inspect','--format','{{json .}}',ids[0]));}
  catch(error){throw new Error('Synthetic network inspection failed; resource state is unknown',{cause:error});}
  if(!/^[a-f0-9]{64}$/.test(observed?.Id||'')||!observed.Id.startsWith(ids[0])||observed.Name!==name||
    observed.Labels?.['study.run.id']!==runId||(kind==='agent'&&observed.Internal!==true)||
    !observed.Containers||typeof observed.Containers!=='object'||Array.isArray(observed.Containers))throw new Error('Synthetic network resource identity does not match the run');
  lease.assertHeld();return {state:'present',id:observed.Id,attached:Object.keys(observed.Containers).length};
}

export async function retireDockerNetwork({runId,kind,lease,runDocker=docker}={}){
  const original=await inspectDockerNetwork({runId,kind,lease,runDocker});if(original.state==='absent')return original;
  if(original.attached)throw new Error('Synthetic network still has attached containers');
  lease.assertHeld();
  try{await runDocker('network','rm',original.id);}catch(error){
    const current=await inspectDockerNetwork({runId,kind,lease,runDocker});if(current.state==='absent')return current;
    throw new Error('Synthetic network removal could not be verified',{cause:error});
  }
  const result=await inspectDockerNetwork({runId,kind,lease,runDocker});
  if(result.state!=='absent')throw new Error('Synthetic network retirement could not be verified');
  return result;
}
