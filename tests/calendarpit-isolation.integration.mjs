// Opt in explicitly: CALENDARPIT_LIVE_TEST=1 node --test tests/calendarpit-isolation.integration.mjs
// This creates and removes two synthetic Docker containers; it never uses real accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
