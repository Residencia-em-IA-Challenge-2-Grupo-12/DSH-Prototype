// CALENDARPIT_LIVE_TEST=1 node --test tests/calendar-replay.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CalendarApiError } from '../src/foundation/calendarpit-api.mjs';
import {
  observeReplay, replayCalendarExperiment, startCalendarExperiment,
} from '../src/foundation/calendar-experiment.mjs';

const exec = promisify(execFile);
const redirectUri = 'http://127.0.0.1:4175/callback';
const context = { scenarioId: 'ana', simulatedClock: '2026-11-02T00:00:00-03:00',
  timeZone: 'America/Sao_Paulo', generatorVersion: 'recurrence-test-v1', seed: '0' };
const calendarId = 'ana-calendar';
const time = (date, hour) => ({ dateTime: `${date}T${hour}:00:00-03:00`, timeZone: context.timeZone });
const fixture = {
  users: [{ id: 'ana', name: 'Synthetic Student', email: 'ana@example.test' }],
  calendars: [{ id: calendarId, userId: 'ana', primary: true, summary: 'School', timeZone: context.timeZone }],
  events: [
    { id: 'series', calendarId, summary: 'Study', start: time('2026-11-02', '09'),
      end: time('2026-11-02', '10'), recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'],
      extendedProperties: { private: { owner: 'demo' } } },
    { id: 'exception', calendarId, status: 'cancelled',
      start: time('2026-11-09', '09'), end: time('2026-11-09', '10'),
      recurringEventId: 'series', originalStartTime: time('2026-11-09', '09') },
  ],
};
const studyEvent = { id: 'abcde0123456', summary: 'Synthetic checkpoint study',
  description: 'Retain this note', start: time('2026-11-02', '13'),
  end: time('2026-11-02', '14'), extendedProperties: { private: { studyDemo: 'true', student: 'ana' } } };

async function closeAndVerify(run) {
  await run.close();
  const [containers, networks] = await Promise.all([
    exec('docker', ['ps', '-a', '--filter', `label=study.run.id=${run.runId}`, '--format', '{{.ID}}']),
    exec('docker', ['network', 'ls', '--filter', `label=study.run.id=${run.runId}`, '--format', '{{.ID}}']),
  ]);
  assert.equal(containers.stdout.trim(), '');
  assert.equal(networks.stdout.trim(), '');
}

test('checkpoint round-trips stored recurrence and provider calls across isolated replays',
  { skip: process.env.CALENDARPIT_LIVE_TEST !== '1', timeout: 90_000 }, async t => {
    const original = await startCalendarExperiment({ fixture, context, redirectUri });
    t.after(() => closeAndVerify(original));
    const oldToken = await original.authorize('ana');
    const oldApproval = { runId: original.runId };
    const verifier = run => (_action, approval) => approval.runId === run.runId;
    const oldClient = original.provider(oldToken, verifier(original));
    const firstEvent = await oldClient.createApprovedEvent({ calendarId, event: studyEvent, approval: oldApproval });

    const checkpoint = await original.checkpoint();
    const saved = JSON.stringify(checkpoint);
    assert(!saved.includes(oldToken));
    assert.deepEqual(checkpoint.replay.fixture.clients, []);
    const replay = async () => {
      const run = await replayCalendarExperiment({ checkpoint: JSON.parse(saved), redirectUri });
      t.after(() => closeAndVerify(run));
      return run;
    };
    const [left, right] = await Promise.all([replay(), replay()]);
    assert.equal(new Set([original.runId, left.runId, right.runId]).size, 3);
    const [leftToken, rightToken] = await Promise.all([left.authorize('ana'), right.authorize('ana')]);
    assert.equal(new Set([oldToken, leftToken, rightToken]).size, 3);
    const leftClient = left.provider(leftToken, verifier(left));
    const rightClient = right.provider(rightToken);
    await assert.rejects(() => left.provider(oldToken).getEvent(calendarId, studyEvent.id),
      error => error instanceof CalendarApiError && error.status === 401);

    for (const run of [left, right]) {
      const child = await run.checkpoint();
      assert.equal(child.lineage.parentCheckpointId, checkpoint.checkpointId);
      assert.equal(child.lineage.runId, run.runId);
      assert.deepEqual(child.context, checkpoint.context);
      assert.deepEqual(child.replay.fixture, checkpoint.replay.fixture);
      const observed = await observeReplay(run, checkpoint.replay.fixture);
      assert.deepEqual(observed.map(event => event.id).sort(), ['abcde0123456', 'exception', 'series']);
      const exception = observed.find(event => event.id === 'exception');
      assert.equal(exception.status, 'cancelled');
      assert.deepEqual(exception.originalStartTime, fixture.events[1].originalStartTime);
      const series = observed.find(event => event.id === 'series');
      assert.deepEqual(series.recurrence, fixture.events[0].recurrence);
      assert.deepEqual(series.extendedProperties, fixture.events[0].extendedProperties);
    }
    const restored = await leftClient.getEvent(calendarId, studyEvent.id);
    assert.equal(restored.description, studyEvent.description);
    assert.notEqual(restored.etag, firstEvent.etag);
    const change = { calendarId, eventId: restored.id, etag: restored.etag, changes: { summary: 'Left only' } };
    await assert.rejects(() => leftClient.patchApprovedEvent({ ...change, approval: oldApproval }), /approval rejected/);
    assert.equal((await leftClient.getEvent(calendarId, restored.id)).summary, studyEvent.summary);
    await leftClient.patchApprovedEvent({ ...change, approval: { runId: left.runId } });
    assert.equal((await leftClient.getEvent(calendarId, restored.id)).summary, 'Left only');
    assert.equal((await rightClient.getEvent(calendarId, restored.id)).summary, studyEvent.summary);
  });
