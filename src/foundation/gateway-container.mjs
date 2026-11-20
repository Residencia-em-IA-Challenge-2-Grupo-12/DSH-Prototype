import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createModelBudget} from './model-budget.mjs';
import {createOpenRouterGateway} from './openrouter-gateway.mjs';

// Only this trusted service receives the secret file. No live connection is
// enabled here: the network is internal and pricing has not been verified.
const env=parseEnv(await readFile('/run/secrets/openrouter_env','utf8'));
if(!env.OPENROUTER_API_KEY?.trim())throw new Error('OPENROUTER_API_KEY is missing from the configured environment file');
const accessToken=(await readFile('/run/secrets/gateway_token','utf8')).trim();
if(!/^[a-f0-9]{64}$/.test(accessToken))throw new Error('The internal gateway credential is invalid');
const budget=await createModelBudget({directory:'/var/lib/study-model-budget'});
const server=createOpenRouterGateway({apiKey:env.OPENROUTER_API_KEY,accessToken,budget,pricing:null});
server.listen(8090,'0.0.0.0',()=>console.log('Experimental gateway isolated; live model calls are disabled.'));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(async()=>{await budget.close();process.exit(0);}));
