import assert from 'node:assert/strict';
import test from 'node:test';
import { makePlan, summarize } from '../src/core.mjs';

test('makePlan and summarize respect custom simulation today and timezoneOffset', () => {
  const student = {
    student: 'ana',
    timezone: 'UTC',
    targetHours: 2,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    studyWindows: [
      { weekday: 1, start: '09:00', end: '12:00' },
      { weekday: 3, start: '09:00', end: '12:00' },
    ],
    courses: [{ name: 'Linear Algebra', source: 'courses/la.md', deadline: '2027-03-25T18:00:00+00:00' }],
  };
  const existingNear = {
    id: 'old-near',
    summary: 'Study: Linear Algebra',
    start: { dateTime: '2027-03-03T10:00:00+00:00', timeZone: 'UTC' },
    end: { dateTime: '2027-03-03T11:00:00+00:00', timeZone: 'UTC' },
    extendedProperties: { private: { studyDemo: 'true', student: 'ana' } },
  };
  const existingFuture = {
    id: 'old-future',
    summary: 'Study: Linear Algebra',
    start: { dateTime: '2027-03-10T10:00:00+00:00', timeZone: 'UTC' },
    end: { dateTime: '2027-03-10T11:00:00+00:00', timeZone: 'UTC' },
    extendedProperties: { private: { studyDemo: 'true', student: 'ana' } },
  };
  const plan = makePlan(student, [existingNear, existingFuture], {
    weeks: 2,
    today: '2027-03-01',
    timezoneOffset: '+00:00',
  });
  assert.equal(plan.fixedToday, '2027-03-01');
  assert.equal(plan.near.length, 2);
  assert.equal(plan.future.length, 2);
  assert.ok(plan.near.every(block => block.start.dateTime.endsWith('+00:00') && block.start.dateTime.slice(0, 10) < '2027-03-08'));
  assert.ok(plan.future.every(block => block.start.dateTime.endsWith('+00:00') && block.start.dateTime.slice(0, 10) >= '2027-03-08'));
  assert.deepEqual(plan.remove.near.map(e => e.id), ['old-near']);
  assert.deepEqual(plan.remove.future.map(e => e.id), ['old-future']);

  const pastEvent = {
    id: 'past-study',
    summary: 'Study: Linear Algebra',
    start: { dateTime: '2027-02-24T10:00:00+00:00', timeZone: 'UTC' },
    end: { dateTime: '2027-02-24T12:00:00+00:00', timeZone: 'UTC' },
  };
  const metrics = summarize([pastEvent, existingNear], [], { annotations: {}, history: [], plan }, {
    today: '2027-03-01',
    timezoneOffset: '+00:00',
  });
  assert.equal(metrics.periods.recent.start, '2027-02-22T00:00:00+00:00');
  assert.equal(metrics.periods.upcoming.start, '2027-03-01T00:00:00+00:00');
  assert.equal(metrics.periods.recent.categories.study, 2);
  assert.equal(metrics.periods.upcoming.categories.study, 1);

  assert.throws(() => makePlan(student, [], { today: 'not-a-date' }), /clock date/i);
  assert.throws(() => makePlan(student, [], { timezoneOffset: 'UTC' }), /timezone offset/i);
});
