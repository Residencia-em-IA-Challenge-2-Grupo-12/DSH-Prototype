import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OPENROUTER_MODEL} from './openrouter-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

// The token authenticates only to the trusted gateway; it is never the real
// provider key. A caller must isolate the process and its other environment.
export function createGatewayRoute({baseURL,accessToken}={}){
  let url;try{url=new URL(baseURL);}catch{throw new Error('Invalid local gateway URL');}
  const local=url.hostname==='127.0.0.1'&&url.port!=='';
  const docker=url.hostname==='model-gateway'&&url.port==='8090';
  if(url.protocol!=='http:'||(!local&&!docker)||url.pathname!=='/v1'||url.username||url.password||url.search||url.hash)throw new Error('Only the trusted local gateway is allowed');
  if(typeof accessToken!=='string'||!/^[a-f0-9]{64}$/.test(accessToken))throw new Error('A dedicated gateway token is required');
  return {provider:'study-gateway',model:OPENROUTER_MODEL,patch:path.join(root,'dsh-gateway.patch.yml'),
    env:{STUDY_GATEWAY_BASE_URL:url.href.replace(/\/$/,''),STUDY_GATEWAY_TOKEN:accessToken}};
}
