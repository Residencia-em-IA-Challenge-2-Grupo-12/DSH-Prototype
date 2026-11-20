import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Calendarpit} from './core.mjs';
import {createStudyBoundary} from './foundation/study-boundary.mjs';
import {registerStudyTools} from './mcp-tools.mjs';

// Legacy local baseline only. Disposable runs must use mcp-broker.mjs.
const server=new McpServer({name:'synthetic-study-demo',version:'0.1.0'});
registerStudyTools(server,(method,args)=>createStudyBoundary({student:args.student,calendar:new Calendarpit(),requireStaged:false}).call(method,args));
await server.connect(new StdioServerTransport());
