// CALENDARPIT_LIVE_TEST=1 node --test --test-isolation=none tests/calendarpit-api.integration.mjs
// Uses a disposable Calendarpit container and synthetic consent only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { CalendarpitApi, CalendarApiError } from '../src/foundation/calendarpit-api.mjs';
import { startCalendarpitRun } from '../src/foundation/calendarpit-runner.mjs';
import { createClaimedCalendar } from '../src/foundation/claimed-calendar.mjs';
import {initializeScenario,draft,applyApproved,getRecoveryClaim,loadState} from '../src/core.mjs';
import {runtimeDir,ROOT} from '../src/core.mjs';
import {createStudyBoundary} from '../src/foundation/study-boundary.mjs';
import {startStudyBroker} from '../src/foundation/study-broker.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import {syntheticToken} from './fixtures/calendarpit-oauth.mjs';

test('synthetic OAuth supports v3 reads and reviewed ETag-protected event writes', { skip: process.env.CALENDARPIT_LIVE_TEST !== '1', timeout: 60_000 }, async () => {
  const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/calendars/ana.json', import.meta.url), 'utf8'));
  const redirectUri = 'http://127.0.0.1:4175/callback';
  const run = await startCalendarpitRun({ fixture, redirectUri });
  try {
    const token = await syntheticToken(run, 'ana', redirectUri);
    const client = new CalendarpitApi({ origin: run.origin, accessToken: token, authorizeWrite: async (_action, approval) => approval.decisionId === 'test-approved' });
    const approval = { decisionId: 'test-approved' };
    const calendarId = 'ana-calendar';
    const existing = await client.listEvents(calendarId, { timeMin: '2026-11-02T00:00:00-03:00', timeMax: '2026-11-09T00:00:00-03:00' });
    assert(existing.items.length > 0);
    const busy = await client.freeBusy({ timeMin: '2026-11-02T00:00:00-03:00', timeMax: '2026-11-09T00:00:00-03:00', calendarIds: [calendarId] });
    assert(Array.isArray(busy.calendars[calendarId].busy));
    const event = { id: 'aabbccddee2026', summary: 'Synthetic study', description: 'Keep this description', start: { dateTime: '2026-11-02T13:00:00-03:00' }, end: { dateTime: '2026-11-02T14:00:00-03:00' } };
    const created = await client.createApprovedEvent({ calendarId, event, approval });
    assert.equal(created.id, event.id);
    const observed = await client.getEvent(calendarId, event.id);
    assert(observed.etag);
    const patched = await client.patchApprovedEvent({ calendarId, eventId: event.id, etag: observed.etag, changes: { summary: 'Revised synthetic study' }, approval });
    assert.equal(patched.description, event.description);
    await assert.rejects(() => client.patchApprovedEvent({ calendarId, eventId: event.id, etag: observed.etag, changes: { summary: 'Stale write' }, approval }), error => error instanceof CalendarApiError && error.status === 412);
    await client.deleteApprovedEvent({ calendarId, eventId: event.id, etag: patched.etag, approval });
  } finally {
    await run.close();
  }
});

test('claim-bound calendar adapter uses synthetic OAuth for reviewed writes', { skip: process.env.CALENDARPIT_LIVE_TEST !== '1', timeout: 60000 }, async()=>{
  const fixture=JSON.parse(await fs.readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
  const redirectUri='http://127.0.0.1:4175/callback',run=await startCalendarpitRun({fixture,redirectUri});
  try {
    const accessToken=await syntheticToken(run,'ana',redirectUri);
    let claim;
    const calendar=createClaimedCalendar({origin:run.origin,accessToken,getClaim:async()=>claim});
    const initial=await calendar.events('ana');assert(initial.length>5);
    const event={id:'aabbccddee2027',summary:'Synthetic study',description:'Original notes',start:{dateTime:'2026-11-03T12:00:00-03:00'},end:{dateTime:'2026-11-03T13:00:00-03:00'}};
    const setClaim=action=>{claim={id:'claim',student:'ana',kind:action.type==='patch'?'annotation':'approval',section:'near',decision:{kind:'approved',section:'near'},actions:[action],steps:[{actionId:action.actionId,status:'sent'}]};};
    setClaim({actionId:`create:${event.id}`,type:'create',event});
    await calendar.create('ana',event);
    const created=(await calendar.events('ana')).find(item=>item.id===event.id);assert(created);
    const changes={description:'Original notes\n\n[Study Atlas]\nCategory / Categoria: study\n[/Study Atlas]'};
    setClaim({actionId:`patch:${event.id}`,type:'patch',eventId:event.id,before:created,after:changes});
    await calendar.patch('ana',event.id,changes);
    const edited=(await calendar.events('ana')).find(item=>item.id===event.id);assert.equal(edited.description,changes.description);
    setClaim({actionId:`remove:${event.id}`,type:'remove',event:edited});
    await calendar.remove('ana',event.id);
    assert(!(await calendar.events('ana')).some(item=>item.id===event.id));
  } finally {await run.close();}
});

test('the study planner applies a separately approved section through the provider API', { skip: process.env.CALENDARPIT_LIVE_TEST !== '1', timeout: 60000 }, async()=>{
  const fixture=JSON.parse(await fs.readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
  const redirectUri='http://127.0.0.1:4175/callback',run=await startCalendarpitRun({fixture,redirectUri});
  try {
    const accessToken=await syntheticToken(run,'ana',redirectUri);
    const calendar=createClaimedCalendar({origin:run.origin,accessToken,getClaim:getRecoveryClaim});
    await initializeScenario(calendar,'ana');
    const before=await calendar.events('ana');
    const proposal=await draft(calendar,'ana',{weeks:2,hours:2});
    assert.equal((await calendar.events('ana')).length,before.length);
    await applyApproved(calendar,'ana',proposal.id,'near');
    assert.equal((await calendar.events('ana')).length,before.length+proposal.near.length);
    const state=await loadState('ana');
    assert.equal(state.plan.status.near,'applied');assert.equal(state.plan.status.future,'pending');
    assert.equal(await getRecoveryClaim(),null);
  } finally {await run.close();}
});

test('brokered agent draft reaches the provider only after separate trusted approval', {skip:process.env.CALENDARPIT_LIVE_TEST!=='1',timeout:60000},async()=>{
  const fixture=JSON.parse(await fs.readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
  const redirectUri='http://127.0.0.1:4175/callback',run=await startCalendarpitRun({fixture,redirectUri});let broker,client;
  try {
    const accessToken=await syntheticToken(run,'ana',redirectUri);
    const calendar=createClaimedCalendar({origin:run.origin,accessToken,getClaim:getRecoveryClaim});
    await initializeScenario(calendar,'ana');
    const ipc=path.join(runtimeDir(),'ipc');await fs.mkdir(ipc,{mode:0o700});const socketPath=path.join(ipc,'agent.sock');
    broker=await startStudyBroker({socketPath,boundary:createStudyBoundary({student:'ana',calendar})});
    client=new Client({name:'synthetic-provider-broker',version:'1.0.0'});
    await client.connect(new StdioClientTransport({command:process.execPath,args:[ROOT+'/src/mcp-broker.mjs'],env:{PATH:process.env.PATH,STUDY_BROKER_SOCKET:socketPath}}));
    const before=await calendar.events('ana');
    const out=await client.callTool({name:'draft_study_plan',arguments:{student:'ana',weeks:2,hours:2}});
    assert(!out.isError,JSON.stringify(out));const plan=JSON.parse(out.content[0].text);assert(plan.near.length>0);
    assert.equal((await calendar.events('ana')).length,before.length);
    const tools=(await client.listTools()).tools;assert(!tools.some(tool=>/approve|apply|delete|write_calendar/.test(tool.name)));
    await applyApproved(calendar,'ana',plan.id,'near');
    assert.equal((await calendar.events('ana')).length,before.length+plan.near.length);
    assert.equal((await loadState('ana')).plan.status.future,'pending');
    assert.equal(await getRecoveryClaim(),null);
  } finally {await client?.close();await broker?.close();await run.close();}
});
