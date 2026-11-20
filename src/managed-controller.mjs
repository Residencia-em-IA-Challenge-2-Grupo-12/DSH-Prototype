import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createExclusiveRunManager} from './foundation/exclusive-run-manager.mjs';
import {createSyntheticRunDriver} from './foundation/synthetic-run-driver.mjs';
import {createManagedStudyApi} from './foundation/managed-study-api.mjs';
import {startControllerRpc} from './foundation/controller-rpc.mjs';

const root=process.env.STUDY_RUN_ROOT;
if(!root||!path.isAbsolute(root))throw Error('Set an absolute STUDY_RUN_ROOT');
let driver;
const manager=await createExclusiveRunManager({root,driverFactory:({lease})=>{
  driver=createSyntheticRunDriver({root,lease,agentImage:process.env.STUDY_AGENT_IMAGE,
    tokenFile:process.env.STUDY_GATEWAY_TOKEN_FILE,gatewayId:process.env.STUDY_GATEWAY_CONTAINER_ID});return driver;
}});
const ipc=path.join(root,'control');await mkdir(ipc,{recursive:true,mode:0o700});
const server=await startControllerRpc({socketPath:path.join(ipc,'controller.sock'),api:createManagedStudyApi({manager,driver})});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{try{await server.close();await manager.close();process.exit(0);}catch{process.exitCode=1;}});
