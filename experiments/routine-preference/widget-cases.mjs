import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIXED_TODAY, makePlan } from '../../src/core.mjs';
import { measurePlan } from '../planner-readiness/baseline.mjs';

export const clock = { date: FIXED_TODAY, timezone: 'America/Sao_Paulo' };
export const friday = '2026-11-06';
export const caseIds = ['open-choice', 'accepted-fallback', 'expired'];
export const lateCommitment = {
  id: 'ana-fri-appointment', summary: 'New Friday appointment',
  start: { dateTime: friday + 'T14:00:00-03:00' }, end: { dateTime: friday + 'T15:00:00-03:00' },
};
const windows = [
  { weekday: 3, start: '14:00', end: '16:15' },
  { weekday: 5, start: '14:00', end: '16:15' },
  { weekday: 0, start: '14:00', end: '15:00' },
];
const profile = {
  ...JSON.parse(readFileSync(new URL('../../fixtures/students/ana/courses.json', import.meta.url))),
  targetHours: 4, availabilityThrough: '2026-11-08', studyWindows: windows,
};

export function reviewedCase(id) {
  assert.ok(caseIds.includes(id), 'Unknown Ana exercise');
  const current = { kind: 'soft', validFrom: '2026-11-02', validThrough: '2026-11-08' };
  if (id === 'expired') return {
    statement: 'I asked to protect Friday afternoons from 26 October through 1 November only. I have no new request for this week.',
    preference: { kind: 'soft', validFrom: '2026-10-26', validThrough: '2026-11-01' },
  };
  return id === 'accepted-fallback' ? {
    statement: 'Keep Friday afternoon free through 8 November if you can. If I need it for four hours this week, one Friday hour is fine.',
    preference: { ...current, fallbackMinutes: 60 },
  } : {
    statement: 'I aim for four hours this week through 8 November. I would prefer to keep Friday afternoon free.',
    preference: current,
  };
}

export function generateCandidates(events) {
  return [
    { id: 'usual', label: 'Use the usual windows', profile, avoidDates: [] },
    { id: 'free', label: 'Keep Friday free', profile, avoidDates: [friday] },
    { id: 'one', label: 'Use one hour on Friday', profile: { ...profile,
      studyWindows: windows.map(window => window.weekday === 5 ? { ...window, end: '15:00' } : window) }, avoidDates: [] },
  ].map(option => {
    const plan = makePlan(option.profile, events, { weeks: 1, avoidDates: option.avoidDates });
    const measured = measurePlan(plan, events, {
      clock, scenario: { profile, weeks: 1 }, sessionMinutes: 60, slotMinutes: 15,
    });
    assert.deepEqual(measured.findings, [], 'Candidate failed independent validation');
    const windows = plan.near.map(block => ({
      date: block.start.dateTime.slice(0, 10),
      start: block.start.dateTime.slice(11, 16), end: block.end.dateTime.slice(11, 16),
    }));
    const { id, label } = option;
    return { id, label, windows, studyMinutes: measured.scheduledMinutesByWeek[0],
      protectedMinutes: windows.filter(window => window.date === friday).length * 60 };
  });
}
