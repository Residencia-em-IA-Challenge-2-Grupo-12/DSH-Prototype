import {ROOT} from './core.mjs';
import path from 'node:path';
import {createControllerClient} from './foundation/controller-rpc.mjs';
import {createManagedWeb} from './foundation/managed-web.mjs';
const port=Number(process.env.PORT||4176);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local port');
const server=createManagedWeb({api:createControllerClient({socketPath:process.env.STUDY_CONTROLLER_SOCKET}),
  origin:`http://127.0.0.1:${port}`,publicDirectory:path.join(ROOT,'public')});
server.listen(port,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
