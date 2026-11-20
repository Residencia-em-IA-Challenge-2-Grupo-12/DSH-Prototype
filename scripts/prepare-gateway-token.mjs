import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureGatewayTokenFile} from '../src/foundation/gateway-token.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await ensureGatewayTokenFile({directory:path.join(root,'.gateway-control')});
console.log('Private gateway control credential is ready.');
