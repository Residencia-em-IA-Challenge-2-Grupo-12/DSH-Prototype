import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ROOT,initializeScenario,runtimeDir} from '../src/core.mjs';
import {createStudyBoundary} from '../src/foundation/study-boundary.mjs';
import {startStudyBroker} from '../src/foundation/study-broker.mjs';

test('the broker-only MCP can read and draft but cannot approve or fall back on disconnect',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
  let writes=0;const calendar={events:async()=>structuredClone(fixture.events),create:async()=>{writes++;throw new Error('unexpected write');}};
  await initializeScenario(calendar,'ana');
  const directory=join(runtimeDir(),'ipc');await mkdir(directory,{mode:0o700});const socketPath=join(directory,'agent.sock');
  let server=await startStudyBroker({socketPath,boundary:createStudyBoundary({student:'ana',calendar})});
  const transport=new StdioClientTransport({command:process.execPath,args:[ROOT+'/src/mcp-broker.mjs'],
    env:{PATH:process.env.PATH,STUDY_BROKER_SOCKET:socketPath}});
  const client=new Client({name:'synthetic-broker-test',version:'1.0.0'});
  try {
    await client.connect(transport);
    const {tools}=await client.listTools();
    assert.equal(tools.length,7);assert(!tools.some(tool=>/approve|apply|delete|write_calendar/.test(tool.name)));
    const read=await client.callTool({name:'list_calendar',arguments:{student:'ana'}});assert(!read.isError,JSON.stringify(read));
    const draft=await client.callTool({name:'draft_study_plan',arguments:{student:'ana',weeks:2,hours:2}});assert(!draft.isError,JSON.stringify(draft));
    const cross=await client.callTool({name:'list_calendar',arguments:{student:'bruno'}});assert.equal(cross.isError,true);
    assert.equal(writes,0);
    await server.close();server=null;
    const unavailable=await client.callTool({name:'list_calendar',arguments:{student:'ana'}});assert.equal(unavailable.isError,true);
    assert.equal(writes,0);
  } finally {await client.close();await server?.close();}
});
