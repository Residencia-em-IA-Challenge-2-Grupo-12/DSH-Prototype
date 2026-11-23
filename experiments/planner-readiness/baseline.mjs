import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXED_TODAY, makePlan } from '../../src/core.mjs';
import { validateSchedule } from '../../src/paired-replay/schedule.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function readEvents(calendar) {
  if (calendar.events) return structuredClone(calendar.events);
  const bytes = readFileSync(resolve(root, calendar.path));
  assert.equal(hash(bytes), calendar.sha256, 'Frozen calendar changed');
  return JSON.parse(bytes).events;
}

export function measurePlan(plan, events, { clock, scenario, sessionMinutes, slotMinutes }) {
  const actions = blocks => blocks.map(block => ({
    kind: 'add', eventId: block.id, course: block.extendedProperties.private.course,
    start: block.start.dateTime, end: block.end.dateTime,
  }));
  const proposal = {
    sources: scenario.profile.courses.map(course => ({ course: course.name, deadline: course.deadline })),
    sections: { near: actions(plan.near), future: actions(plan.future) },
  };
  const reviewed = { ...scenario.profile, through: scenario.profile.availabilityThrough };
  const findings = validateSchedule(proposal, events, {
    clock, expect: { avoidDates: scenario.avoidDates || [] },
  }, reviewed, { allowShortfall: true });
  if (plan.remove.near.length || plan.remove.future.length) findings.push('Expected additions only for a starting fixture');
  const perCourse = Object.fromEntries(proposal.sources.map(source => [source.course, 0]));
  const weeklyMinutes = Array.from({ length: scenario.weeks }, () => 0);
  for (const block of [...proposal.sections.near, ...proposal.sections.future]) {
    const minutes = (Date.parse(block.end) - Date.parse(block.start)) / 60_000;
    if (minutes !== sessionMinutes) findings.push('Unexpected session duration');
    if (Date.parse(block.start) % (slotMinutes * 60_000) !== 0) findings.push('Session starts outside the fixture grid');
    perCourse[block.course] += minutes;
    const elapsedDays = (Date.parse(block.start.slice(0, 10)) - Date.parse(clock.date)) / 86_400_000;
    weeklyMinutes[Math.floor(elapsedDays / 7)] += minutes;
  }
  if (plan.outlook.some(week => weeklyMinutes[week.week - 1] !== week.scheduledHours * 60 ||
      week.shortfall * 60 !== reviewed.targetHours * 60 - weeklyMinutes[week.week - 1])) {
    findings.push('Proposal outlook disagrees with the measured allocation');
  }
  return { scheduledMinutesByWeek: weeklyMinutes, perCourse, findings };
}

export function runBaseline() {
  const bytes = readFileSync(new URL('./cases.json', import.meta.url));
  const frozen = JSON.parse(bytes);
  assert.equal(frozen.clock.date, FIXED_TODAY, 'Planner clock no longer matches the fixture');
  const results = frozen.cases.map(scenario => {
    const events = readEvents(scenario.calendar);
    const options = { weeks: scenario.weeks, avoidDates: scenario.avoidDates, focusCourse: scenario.focusCourse };
    const run = overrides => {
      const profile = { ...scenario.profile, timezone: frozen.clock.timezone, ...overrides.profile };
      const started = performance.now();
      const plan = makePlan(profile, events, { ...options, ...overrides.options });
      const elapsedMs = performance.now() - started;
      return {
        ...measurePlan(plan, events, { clock: frozen.clock, scenario, sessionMinutes: frozen.sessionMinutes, slotMinutes: frozen.slotMinutes }),
        elapsedMs: Number(elapsedMs.toFixed(3)),
      };
    };
    const variants = { current: run({}) };
    if (!scenario.focusCourse) variants.coverageOption = run({ options: { allocation: 'course-coverage' } });
    if (scenario.id === 'bruno-equal-cutoff') {
      variants.reversedCourseOrder = run({ profile: { courses: [...scenario.profile.courses].reverse() } });
    }
    return { id: scenario.id, heldOut: Boolean(scenario.heldOut), knownFeasibleMinutes: scenario.knownFeasibleMinutes, variants };
  });
  return { schemaVersion: frozen.schemaVersion, baseline: frozen.baseline, casesSha256: hash(bytes), results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runBaseline();
  console.log(JSON.stringify(result, null, 2));
  if (result.results.some(item => Object.values(item.variants).some(variant => variant.findings.length))) process.exitCode = 1;
}
