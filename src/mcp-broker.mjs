import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createStudyBrokerClient} from './foundation/study-broker.mjs';
import {registerStudyTools} from './mcp-tools.mjs';

// Missing or unreachable IPC is an error, never a reason to fall back to a
// direct simulator or a different workspace.
const client=createStudyBrokerClient({socketPath:process.env.STUDY_BROKER_SOCKET});
const server=new McpServer({name:'synthetic-study-demo',version:'0.1.0'});
registerStudyTools(server,(method,args)=>client.call(method,args));
await server.connect(new StdioServerTransport());
