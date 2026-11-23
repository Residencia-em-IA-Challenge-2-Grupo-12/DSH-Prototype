import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIXED_TODAY, makePlan } from '../../src/core.mjs';
import { measurePlan } from '../planner-readiness/baseline.mjs';

export const clock = { date: FIXED_TODAY, timezone: 'America/Sao_Paulo' };
export const friday = '2026-11-06';
export const dateInWeek = (week, weekday = 0) =>
  new Date(Date.parse(FIXED_TODAY) + (week * 7 + weekday) * 86_400_000).toISOString().slice(0, 10);
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

export function generateCandidates(events, { week = 0, includeProposal = false } = {}) {
  const reviewed = { ...profile, availabilityThrough: dateInWeek(week, 6) };
  const earlierDates = week ? Array.from({ length: week * 7 }, (_, day) => dateInWeek(0, day)) : [];
  const protectedDate = dateInWeek(week, 4);
  return [
    { id: 'usual', label: 'Use the usual windows', profile: reviewed, avoidDates: [] },
    { id: 'free', label: 'Keep Friday free', profile: reviewed, avoidDates: [protectedDate] },
    { id: 'one', label: 'Use one hour on Friday', profile: { ...reviewed,
      studyWindows: windows.map(window => window.weekday === 5 ? { ...window, end: '15:00' } : window) }, avoidDates: [] },
  ].map(option => {
    const plan = makePlan(option.profile, events, { weeks: week + 1, avoidDates: [...earlierDates, ...option.avoidDates] });
    const measured = measurePlan(plan, events, {
      clock, scenario: { profile: reviewed, weeks: week + 1, avoidDates: earlierDates }, sessionMinutes: 60, slotMinutes: 15,
    });
    assert.deepEqual(measured.findings, [], 'Candidate failed independent validation');
    const windows = (week ? plan.future : plan.near).map(block => ({
      date: block.start.dateTime.slice(0, 10),
      start: block.start.dateTime.slice(11, 16), end: block.end.dateTime.slice(11, 16),
    }));
    const { id, label } = option;
    return { id, label, windows, studyMinutes: measured.scheduledMinutesByWeek[week],
      protectedMinutes: windows.filter(window => window.date === protectedDate).length * 60,
      ...(includeProposal ? { proposal: { ...plan, previewOnly: true } } : {}) };
  });
}
