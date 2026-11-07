// Opt in: RUN_CALENDARPIT_REPLAY_INTEGRATION=1 node --test tests/calendar-replay.integration.mjs
// Requires Docker access and the pinned image already present locally. The test
// starts its own memory-only container on a random loopback port and removes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { snapshotToReplayFixture } from '../src/calendar-replay.mjs';

const docker = promisify(execFile);
const image = 'ghcr.io/iktakahiro/calendarpit:0.9.7@sha256:6baaca2eb2e587dbc52f9e63f7bc787188569578a6cba2981b1e380c91e54e96';
const enabled = process.env.RUN_CALENDARPIT_REPLAY_INTEGRATION === '1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(base, path, data) {
  const response = await fetch(`${base}/__calendarpit/${path}`, data === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

const start = { dateTime: '2026-11-02T09:00:00-03:00', timeZone: 'America/Sao_Paulo' };
const fixture = {
  users: [{ id: 'student', name: 'Synthetic Student', email: 'student@example.test' }],
  calendars: [{ id: 'school', userId: 'student', summary: 'School', timeZone: 'America/Sao_Paulo', primary: true }],
  events: [
    { id: 'series', calendarId: 'school', summary: 'Study', start,
      end: { dateTime: '2026-11-02T10:00:00-03:00', timeZone: 'America/Sao_Paulo' },
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'], extendedProperties: { private: { owner: 'demo' } } },
    { id: 'exception', calendarId: 'school', summary: 'Cancelled study', status: 'cancelled',
      start: { dateTime: '2026-11-09T09:00:00-03:00', timeZone: 'America/Sao_Paulo' },
      end: { dateTime: '2026-11-09T10:00:00-03:00', timeZone: 'America/Sao_Paulo' },
      recurringEventId: 'series', originalStartTime: { dateTime: '2026-11-09T09:00:00-03:00', timeZone: 'America/Sao_Paulo' } },
  ],
  clients: [],
};

test('replay fixture round-trips real Calendarpit stored data in a disposable container', { skip: !enabled, timeout: 60_000 }, async t => {
  const name = `calendarpit-replay-test-${randomUUID()}`;
  // Register cleanup before startup, including if the CLI fails after container creation.
  t.after(async () => { await docker('docker', ['rm', '-f', name]).catch(() => {}); });
  await docker('docker', ['run', '--detach', '--rm', '--pull=never', '--name', name,
    '--publish', '127.0.0.1::4173', '--env', 'CALENDARPIT_DATABASE=:memory:', image]);
  const { stdout } = await docker('docker', ['port', name, '4173/tcp']);
  const match = stdout.trim().match(/^127\.0\.0\.1:(\d+)$/m);
  assert.ok(match, `Expected a loopback port, got ${stdout}`);
  const base = `http://127.0.0.1:${match[1]}`;
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await request(base, 'health'); healthy = true; break; } catch { await delay(100); }
  }
  assert.ok(healthy, 'Disposable Calendarpit instance failed to become healthy');

  await request(base, 'fixtures', fixture);
  const initial = await request(base, 'state');
  const bundle = snapshotToReplayFixture(initial);
  assert.equal(bundle.fixture.events.length, 2);
  assert.ok(bundle.fixture.events.find(event => event.id === 'exception' && event.status === 'cancelled'));
  assert.ok(bundle.fixture.events.find(event => event.id === 'series').recurrence.length);
  assert.deepEqual(bundle.fixture.clients, []);
  await request(base, 'fixtures', bundle.fixture);
  const replayed = await request(base, 'state');
  const replayBundle = snapshotToReplayFixture(replayed);
  assert.deepEqual(replayBundle.fixture, bundle.fixture);
  assert.notEqual(replayBundle.observations.events[0].etag, bundle.observations.events[0].etag);
  assert.equal(replayBundle.fixture.events.find(event => event.id === 'series').extendedProperties.private.owner, 'demo');
});
