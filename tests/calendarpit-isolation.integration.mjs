// Opt in explicitly: CALENDARPIT_LIVE_TEST=1 node --test tests/calendarpit-isolation.integration.mjs
// This creates and removes two synthetic Docker containers; it never uses real accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { startCalendarpitRun } from '../src/foundation/calendarpit-runner.mjs';

const enabled = process.env.CALENDARPIT_LIVE_TEST === '1';
const fixtureUrl = name => new URL(`../fixtures/calendars/${name}.json`, import.meta.url);
async function request(origin, endpoint, options = {}) {
  const response = await fetch(`${origin}/__calendarpit${endpoint}`, {
    ...options,
    signal: AbortSignal.timeout(5_000),
    headers: { 'content-type': 'application/json', ...options.headers }
  });
  if (!response.ok) throw new Error(`Calendarpit management request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

test('concurrent synthetic runs isolate state and reset and are cleaned up', { skip: !enabled, timeout: 60_000 }, async () => {
  const ana = JSON.parse(await fs.readFile(fileURLToPath(fixtureUrl('ana')), 'utf8'));
  const bruno = JSON.parse(await fs.readFile(fileURLToPath(fixtureUrl('bruno')), 'utf8'));
  let first, second;
  try {
    first = await startCalendarpitRun({ fixture: ana, redirectUri: 'http://127.0.0.1:4175/callback' });
    second = await startCalendarpitRun({ fixture: bruno, redirectUri: 'http://127.0.0.1:4175/callback' });
    for (const run of [first, second]) {
      const origin = new URL(run.origin);
      assert.equal(origin.protocol, 'http:');
      assert.equal(origin.hostname, '127.0.0.1');
      assert(origin.port);
    }
    assert.notEqual(first.origin, second.origin);
    const aBefore = await request(first.origin, '/state');
    const bBefore = await request(second.origin, '/state');
    assert(aBefore.users.some(user => user.id === 'ana'));
    assert(!aBefore.users.some(user => user.id === 'bruno'));
    assert(bBefore.users.some(user => user.id === 'bruno'));
    assert(!bBefore.users.some(user => user.id === 'ana'));
    assert(aBefore.events.some(event => event.id === 'ana-study-past'));
    assert(bBefore.events.some(event => event.id === 'bruno-study-past'));
    await request(first.origin, '/calendars/ana-calendar/events/ana-study-past', { method: 'PATCH', body: JSON.stringify({ summary: 'Changed in first run' }) });
    await request(second.origin, '/calendars/bruno-calendar/events/bruno-study-past', { method: 'PATCH', body: JSON.stringify({ summary: 'Changed in second run' }) });
    await request(first.origin, '/reset', { method: 'POST', body: '{}' });
    const aAfter = await request(first.origin, '/state');
    const bAfter = await request(second.origin, '/state');
    assert.equal(aAfter.events.find(event => event.id === 'ana-study-past').summary, aBefore.events.find(event => event.id === 'ana-study-past').summary);
    assert.equal(bAfter.events.find(event => event.id === 'bruno-study-past').summary, 'Changed in second run');
    assert.equal(bAfter.events.length, bBefore.events.length);
    await request(second.origin, '/reset', { method: 'POST', body: '{}' });
    const bReset = await request(second.origin, '/state');
    assert.equal(bReset.events.find(event => event.id === 'bruno-study-past').summary, bBefore.events.find(event => event.id === 'bruno-study-past').summary);
  } finally {
    // Start failure of either instance must still tear down any already-created instance.
    const results = await Promise.allSettled([first?.close(), second?.close()]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  for (const origin of [first.origin, second.origin]) {
    await assert.rejects(() => fetch(`${origin}/__calendarpit/health`, { signal: AbortSignal.timeout(2_000) }));
  }
});

test('a separate agent network cannot reach simulator administration or the Docker socket', {skip:!enabled,timeout:60000},async()=>{
  const docker=promisify(execFile),agentNetwork=`study-agent-test-${randomUUID()}`;
  const fixture=JSON.parse(await fs.readFile(fileURLToPath(fixtureUrl('ana')),'utf8'));
  let run,networkCreated=false;
  try {
    run=await startCalendarpitRun({fixture,redirectUri:'http://127.0.0.1:4175/callback'});
    await docker('docker',['network','create',agentNetwork]);networkCreated=true;
    const inspect=await docker('docker',['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',`study-calendar-${run.id}`]);
    const ip=inspect.stdout.trim();assert.match(ip,/^\d+\.\d+\.\d+\.\d+$/);
    const hostPort=new URL(run.origin).port;
    const script=`const fs=require('node:fs');const urls=process.argv.slice(1);Promise.all(urls.map(async u=>{try{await fetch(u,{signal:AbortSignal.timeout(1200)});return true}catch{return false}})).then(reachable=>console.log(JSON.stringify({reachable,socket:fs.existsSync('/var/run/docker.sock')})));`;
    const result=await docker('docker',['run','--rm','--pull=never','--network',agentNetwork,'--add-host','host.docker.internal:host-gateway',
      'node:24.11.1-bookworm-slim','node','-e',script,`http://${ip}:4173/__calendarpit/health`,`http://host.docker.internal:${hostPort}/__calendarpit/health`],{timeout:15000});
    const observed=JSON.parse(result.stdout.trim());
    assert.deepEqual(observed.reachable,[false,false],'agent network reached the simulator administration endpoint');
    assert.equal(observed.socket,false,'agent container exposed the Docker socket');
  } finally {
    if(networkCreated)await docker('docker',['network','rm',agentNetwork]);
    await run?.close();
  }
});
