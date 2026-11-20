import test from 'node:test';
import assert from 'node:assert/strict';
import { startCalendarExperiment, replayCalendarExperiment } from '../src/foundation/calendar-experiment.mjs';

const fixture = { users: [{ id: 's', name: 'Synthetic', email: 's@example.test' }], calendars: [{ id: 'c', userId: 's', primary: true, summary: 'Calendar' }], events: [{ id: 'e', calendarId: 'c', summary: 'Study', etag: '"before"' }] };
const context = { scenarioId: 'example', simulatedClock: '2026-11-02T00:00:00-03:00', timeZone: 'America/Sao_Paulo', generatorVersion: '1', seed: '42' };
const redirectUri = 'http://127.0.0.1:4175/callback';
let created = 0;
const startRun = async ({ fixture: seed }) => ({ id: `run-${++created}`, origin: 'http://127.0.0.1:49000', client: { id: 'synthetic', secret: 'secret-never-export' }, fixture: seed, close: async () => {} });
const fetchState = async () => ({ ok: true, json: async () => ({ ...structuredClone(fixture), revision: 1, connections: [{ accessToken: 'never-export-token' }] }) });

test('checkpoint omits credentials, carries lineage and creates a fresh replay instance', async () => {
  const original = await startCalendarExperiment({ fixture, redirectUri, context, startRun, fetchState });
  const first = await original.checkpoint();
  assert(!JSON.stringify(first).includes('never-export'));
  assert(!JSON.stringify(original).includes('secret-never-export'));
  assert.equal(first.lineage.parentCheckpointId, null);
  assert.equal(first.replay.fixture.clients.length, 0);
  const replay = await replayCalendarExperiment({ checkpoint: JSON.parse(JSON.stringify(first)), redirectUri, startRun, fetchState });
  const next = await replay.checkpoint();
  assert.notEqual(replay.runId, original.runId);
  assert.equal(next.lineage.parentCheckpointId, first.checkpointId);
  assert.equal(next.replay.fixture.events[0].id, 'e');
  await replay.close(); await original.close();
});

test('tampered fixture and lineage are rejected before starting a run', async () => {
  const original = await startCalendarExperiment({ fixture, redirectUri, context, startRun, fetchState });
  const saved = await original.checkpoint();
  for (const mutator of [checkpoint => { checkpoint.replay.fixture.events[0].summary = 'edited'; }, checkpoint => { checkpoint.lineage.runId = 'other'; }]) {
    const changed = structuredClone(saved); mutator(changed);
    const count = created;
    await assert.rejects(() => replayCalendarExperiment({ checkpoint: changed, redirectUri, startRun, fetchState }), /integrity/);
    assert.equal(created, count);
  }
  await original.close();
});

test('unsupported checkpoint versions fail before simulator startup', async () => {
  const original = await startCalendarExperiment({ fixture, redirectUri, context, startRun, fetchState });
  try {
    const saved = await original.checkpoint();
    const count = created;
    await assert.rejects(() => replayCalendarExperiment({
      checkpoint: { ...saved, schemaVersion: 2 }, redirectUri, startRun, fetchState,
    }), /unsupported checkpoint version/i);
    assert.equal(created, count);
  } finally {
    await original.close();
  }
});
