import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotToReplayFixture } from '../src/calendar-replay.mjs';

function snapshot() {
  const base = { id: 'series', calendarId: 'school', kind: 'calendar#event', summary: 'Study',
    start: { dateTime: '2026-11-02T09:00:00-03:00', timeZone: 'America/Sao_Paulo' },
    end: { dateTime: '2026-11-02T10:00:00-03:00', timeZone: 'America/Sao_Paulo' },
    status: 'confirmed', transparency: 'opaque', recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'],
    extendedProperties: { private: { owner: 'demo' } }, iCalUID: 'series@example.test', sequence: 2,
    etag: 'old-version', created: 'before', updated: 'after' };
  return { users: [{ id: 'student', name: 'Student', email: 'student@example.test' }],
    calendars: [{ id: 'school', userId: 'student', summary: 'School', primary: true, timeZone: 'America/Sao_Paulo' }],
    events: [base, { ...base, id: 'exception', recurrence: undefined, status: 'cancelled', recurringEventId: 'series', originalStartTime: base.start }],
    clients: [{ id: 'app', redirectUris: ['http://127.0.0.1/callback'] }],
    connections: [{ accessToken: 'sensitive-token' }], channels: [{ token: 'sensitive-channel' }], revision: 3 };
}

test('replay retains calendar content and recurrence exceptions without carrying credentials or stale versions', () => {
  const source = snapshot();
  const result = snapshotToReplayFixture(source);
  assert.deepEqual(Object.keys(result.fixture), ['users', 'calendars', 'events', 'clients']);
  assert.deepEqual(result.fixture.clients, []);
  assert.equal(result.fixture.events[0].recurrence[0], 'RRULE:FREQ=WEEKLY;COUNT=3');
  assert.equal(result.fixture.events[0].extendedProperties.private.owner, 'demo');
  assert.equal(result.fixture.events[1].status, 'cancelled');
  assert.equal(result.fixture.events[1].recurringEventId, 'series');
  assert.deepEqual(result.fixture.events[1].originalStartTime, source.events[1].originalStartTime);
  assert.equal(result.observations.events[0].etag, 'old-version');
  assert.equal(result.fixture.events[0].etag, undefined);
  assert.equal(result.fixture.events[0].created, undefined);
  assert.equal(JSON.stringify(result).includes('sensitive-token'), false);
  assert.equal(JSON.stringify(result).includes('sensitive-channel'), false);
  result.fixture.events[0].extendedProperties.private.owner = 'changed';
  assert.equal(source.events[0].extendedProperties.private.owner, 'demo');
});

test('rejects incomplete or unsupported snapshot entity shapes instead of silently losing data', () => {
  assert.throws(() => snapshotToReplayFixture({}), /users must be an array/);
  const input = snapshot();
  input.events[0].newServerField = true;
  assert.throws(() => snapshotToReplayFixture(input), /unsupported fields: newServerField/);
  delete input.events[0].newServerField;
  delete input.events[0].id;
  assert.throws(() => snapshotToReplayFixture(input), /stable id/);
});
