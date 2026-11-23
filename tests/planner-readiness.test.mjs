import assert from 'node:assert/strict';
import test from 'node:test';
import { runBaseline } from '../experiments/planner-readiness/baseline.mjs';
import { validateSchedule } from '../src/paired-replay/schedule.mjs';

test('frozen planner cases exercise capacity, constraints and one separately identified holdout', () => {
  const { results } = runBaseline();
  assert.equal(results.length, 6);
  assert.equal(results.filter(row => row.heldOut).length, 1);
  for (const row of results) {
    for (const variant of Object.values(row.variants)) {
      assert.deepEqual(variant.findings, [], row.id);
      assert.deepEqual(variant.scheduledMinutesByWeek, row.knownFeasibleMinutes, row.id);
    }
  }
});

test('benchmark may count a shortfall but still rejects over-target schedules', () => {
  const manifest = { clock: { date: '2026-11-02', timezone: 'America/Sao_Paulo' }, expect: { avoidDates: [] } };
  const reviewed = {
    through: '2026-11-08', targetHours: 1, maxDailyStudyHours: 2, studyBreakMinutes: 15,
    studyWindows: [{ weekday: 1, start: '14:00', end: '16:15' }],
  };
  const proposal = {
    sources: [{ course: 'Course A', deadline: '2026-11-09T18:00:00-03:00' }],
    sections: { near: [], future: [] },
  };
  assert.ok(validateSchedule(proposal, [], manifest, reviewed).length > 0);
  assert.deepEqual(validateSchedule(proposal, [], manifest, reviewed, { allowShortfall: true }), []);
  proposal.sections.near.push(
    { kind: 'add', eventId: 'session-a', course: 'Course A', start: '2026-11-02T14:00:00-03:00', end: '2026-11-02T15:00:00-03:00' },
    { kind: 'add', eventId: 'session-b', course: 'Course A', start: '2026-11-02T15:15:00-03:00', end: '2026-11-02T16:15:00-03:00' },
  );
  assert.match(validateSchedule(proposal, [], manifest, reviewed, { allowShortfall: true }).join('\n'), /target/);
});
