import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inspectDockerAgent,inspectDockerNetwork} from './docker-retirement.mjs';

const exec=promisify(execFile);
const docker=async(...args)=>(await exec('docker',args,{timeout:20000,maxBuffer:64000})).stdout.trim();
async function inspectGateway({gatewayId,runId,lease,runDocker}){
  if(typeof gatewayId!=='string'||!/^[a-f0-9]{64}$/.test(gatewayId))throw new Error('An immutable gateway container ID is required');
  lease.assertHeld();let observed;
  try{observed=JSON.parse(await runDocker('inspect','--format','{{json .}}',gatewayId));}
  catch(error){throw new Error('Trusted gateway inspection failed; resource state is unknown',{cause:error});}
  if(observed?.Id!==gatewayId||observed.Config?.Labels?.['study.role']!=='model-gateway'||observed.State?.Running!==true||
    !observed.NetworkSettings?.Networks||typeof observed.NetworkSettings.Networks!=='object')throw new Error('Trusted gateway identity does not match');
  const attachment=observed.NetworkSettings.Networks[`study-agent-net-${runId}`];
  if(attachment&&!attachment.Aliases?.includes('model-gateway'))throw new Error('Trusted gateway network alias does not match');
  lease.assertHeld();return {attached:!!attachment};
}

// The trusted controller owns this operation. The gateway remains a separate
// service; its provider-key file is never mounted into the agent container.
export async function attachRunGateway({runId,gatewayId,lease,runDocker=docker}={}){
  const network=await inspectDockerNetwork({runId,kind:'agent',lease,runDocker});
  if(network.state!=='present')throw new Error('Synthetic agent network is unavailable');
  const gateway=await inspectGateway({gatewayId,runId,lease,runDocker});
  if(gateway.attached)return;
  if(network.attached!==0)throw new Error('Synthetic agent network already has attached containers');
  lease.assertHeld();
  try{await runDocker('network','connect','--alias','model-gateway',network.id,gatewayId);}
  catch(error){throw new Error('Trusted gateway attachment could not be verified',{cause:error});}
  const after=await inspectGateway({gatewayId,runId,lease,runDocker});
  if(!after.attached)throw new Error('Trusted gateway attachment could not be verified');
}

export async function detachRunGateway({runId,gatewayId,lease,runDocker=docker}={}){
  if((await inspectDockerAgent({runId,lease,runDocker})).state!=='absent')throw new Error('Synthetic agent must be retired before detaching the gateway');
  const network=await inspectDockerNetwork({runId,kind:'agent',lease,runDocker});
  if(network.state==='absent'||network.attached===0)return;
  const gateway=await inspectGateway({gatewayId,runId,lease,runDocker});
  if(!gateway.attached||network.attached!==1)throw new Error('Synthetic agent network has unexpected attachments');
  lease.assertHeld();
  try{await runDocker('network','disconnect',network.id,gatewayId);}
  catch(error){throw new Error('Trusted gateway detachment could not be verified',{cause:error});}
  const after=await inspectDockerNetwork({runId,kind:'agent',lease,runDocker});
  if(after.state!=='present'||after.attached!==0)throw new Error('Trusted gateway detachment could not be verified');
}
