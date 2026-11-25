import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function readVerifiedJson(relativePath, expectedSha256 = null) {
  const fullPath = resolve(ROOT, relativePath);
  const bytes = readFileSync(fullPath);
  const actualSha256 = sha256(bytes);
  if (expectedSha256) {
    assert.equal(actualSha256, expectedSha256, `Fixture hash mismatch for ${relativePath}`);
  }
  return { data: JSON.parse(bytes.toString('utf8')), sha256: actualSha256, bytes };
}

export function loadComparisonSuite() {
  const readiness = readVerifiedJson('experiments/planner-readiness/cases.json');
  const frozenRaw = readiness.data;

  const brunoCalendar = readVerifiedJson('fixtures/calendars/bruno.json');
  const anaCalendar = readVerifiedJson('fixtures/calendars/ana.json');
  const brunoReplayCase = readVerifiedJson('fixtures/paired-replay/bruno/case.json');
  const anaReplayCase = readVerifiedJson('fixtures/paired-replay/ana-held-out/case.json');

  const calendarCache = new Map();
  const loadCalendarEvents = calendar => {
    if (calendar.events) return structuredClone(calendar.events);
    if (!calendarCache.has(calendar.path)) {
      const loaded = readVerifiedJson(calendar.path, calendar.sha256);
      calendarCache.set(calendar.path, loaded.data.events);
    }
    return structuredClone(calendarCache.get(calendar.path));
  };

  const frozenCases = frozenRaw.cases.map(scenario => {
    const variants = [{ name: 'default', options: {} }];
    if (!scenario.focusCourse) {
      variants.push({ name: 'coverageOption', options: { allocation: 'course-coverage' } });
    }
    if (scenario.id === 'bruno-equal-cutoff') {
      variants.push({
        name: 'reversedCourseOrder',
        profileOverrides: { courses: [...scenario.profile.courses].reverse() },
        options: {},
      });
    }
    return {
      id: scenario.id,
      group: 'frozen',
      heldOut: Boolean(scenario.heldOut),
      purpose: scenario.purpose,
      weeks: scenario.weeks,
      avoidDates: scenario.avoidDates || [],
      focusCourse: scenario.focusCourse,
      preferredPeriod: scenario.preferredPeriod,
      knownFeasibleMinutes: scenario.knownFeasibleMinutes,
      expectShortfall: scenario.knownFeasibleMinutes.some(m => m < scenario.profile.targetHours * 60),
      profile: { ...scenario.profile, timezone: frozenRaw.clock.timezone },
      events: loadCalendarEvents(scenario.calendar),
      variants,
    };
  });

  // Paired-replay scenarios aligned with src/paired-replay/bruno.mjs, tests/ana-held-out.test.mjs,
  // and fixtures/paired-replay/{bruno,ana-held-out}/case.json.
  const brunoReplayBaseWindows = [
    { weekday: 1, start: '19:00', end: '21:15' },
    { weekday: 3, start: '19:00', end: '21:15' },
    { weekday: 6, start: '14:00', end: '16:15' },
    { weekday: 0, start: '10:00', end: '12:15' },
  ];
  const brunoReplayCourses = [
    {
      name: 'Algoritmos',
      deadline: brunoReplayCase.data.expect.deadline.at,
      source: brunoReplayCase.data.expect.deadline.source,
    },
    {
      name: 'Banco de Dados',
      deadline: '2026-12-14T18:00:00-03:00',
      source: 'courses/banco-de-dados.md',
    },
  ];
  const anaReplayCourses = [
    {
      name: anaReplayCase.data.expect.deadline.course,
      deadline: anaReplayCase.data.expect.deadline.at,
      source: anaReplayCase.data.expect.deadline.source,
    },
  ];
  const anaReplayWindows = [3, 4, 5].map(weekday => ({ weekday, start: '14:00', end: '16:15' }));

  const pairedReplayCases = [
    {
      id: 'bruno-replay-initial',
      group: 'paired-replay',
      heldOut: false,
      purpose: 'Bruno paired-replay initial confirmed context (before Monday removal / avoidDates correction).',
      weeks: 2,
      avoidDates: [],
      knownFeasibleMinutes: [300, 300],
      expectShortfall: false,
      profile: {
        student: 'bruno',
        timezone: brunoReplayCase.data.clock.timezone,
        targetHours: 5,
        maxDailyStudyHours: 2,
        studyBreakMinutes: 15,
        availabilityThrough: '2026-11-15',
        courses: brunoReplayCourses,
        studyWindows: brunoReplayBaseWindows,
      },
      events: structuredClone(brunoCalendar.data.events),
      variants: [
        { name: 'default', options: {} },
        { name: 'coverageOption', options: { allocation: 'course-coverage' } },
      ],
    },
    {
      id: 'bruno-replay-post-correction',
      group: 'paired-replay',
      heldOut: false,
      purpose: 'Bruno paired-replay after Monday correction (weekday 1 window dropped + avoidDates applied).',
      weeks: 2,
      avoidDates: [...brunoReplayCase.data.expect.avoidDates],
      knownFeasibleMinutes: [300, 300],
      expectShortfall: false,
      profile: {
        student: 'bruno',
        timezone: brunoReplayCase.data.clock.timezone,
        targetHours: 5,
        maxDailyStudyHours: 2,
        studyBreakMinutes: 15,
        availabilityThrough: '2026-11-15',
        courses: brunoReplayCourses,
        studyWindows: brunoReplayBaseWindows.filter(w => w.weekday !== 1),
      },
      events: structuredClone(brunoCalendar.data.events),
      variants: [
        { name: 'default', options: {} },
        { name: 'coverageOption', options: { allocation: 'course-coverage' } },
      ],
    },
    {
      id: 'ana-held-out-initial',
      group: 'paired-replay',
      heldOut: true,
      purpose: 'Ana held-out paired-replay initial context before Wednesday 2026-11-04 exclusion.',
      weeks: 2,
      avoidDates: [],
      knownFeasibleMinutes: [240, 240],
      expectShortfall: false,
      profile: {
        student: 'ana',
        timezone: anaReplayCase.data.clock.timezone,
        targetHours: 4,
        maxDailyStudyHours: 2,
        studyBreakMinutes: 15,
        availabilityThrough: '2026-11-15',
        courses: anaReplayCourses,
        studyWindows: anaReplayWindows,
      },
      events: structuredClone(anaCalendar.data.events),
      variants: [
        { name: 'default', options: {} },
        { name: 'coverageOption', options: { allocation: 'course-coverage' } },
      ],
    },
    {
      id: 'ana-held-out-post-correction',
      group: 'paired-replay',
      heldOut: true,
      purpose: 'Ana held-out paired-replay after 2026-11-04 family-logistics exclusion.',
      weeks: 2,
      avoidDates: [...anaReplayCase.data.expect.avoidDates],
      knownFeasibleMinutes: [240, 240],
      expectShortfall: false,
      profile: {
        student: 'ana',
        timezone: anaReplayCase.data.clock.timezone,
        targetHours: 4,
        maxDailyStudyHours: 2,
        studyBreakMinutes: 15,
        availabilityThrough: '2026-11-15',
        courses: anaReplayCourses,
        studyWindows: anaReplayWindows,
      },
      events: structuredClone(anaCalendar.data.events),
      variants: [
        { name: 'default', options: {} },
        { name: 'coverageOption', options: { allocation: 'course-coverage' } },
      ],
    },
  ];

  // Diagnostic edge cases kept strictly separate from frozen/paired-replay aggregates.
  const diagnosticCases = [
    {
      id: 'preferred-period-boundary-packing',
      group: 'diagnostic',
      heldOut: false,
      purpose: 'Diagnostic boundary packing: 11:00-13:15 fits two 1h sessions (11:00-12:00 + 12:15-13:15) when preferredPeriod=afternoon, testing whether greedy period preference causes avoidable shortfall.',
      weeks: 1,
      avoidDates: [],
      preferredPeriod: 'afternoon',
      knownFeasibleMinutes: [120],
      expectShortfall: false,
      profile: {
        student: 'diagnostic-boundary',
        timezone: 'America/Sao_Paulo',
        targetHours: 2,
        maxDailyStudyHours: 2,
        studyBreakMinutes: 15,
        availabilityThrough: '2026-11-08',
        courses: [
          {
            name: 'Calculus',
            deadline: '2026-12-01T18:00:00-03:00',
            source: 'diagnostic:Calculus',
          },
        ],
        studyWindows: [{ weekday: 3, start: '11:00', end: '13:15' }],
      },
      events: [],
      variants: [{ name: 'default', options: { preferredPeriod: 'afternoon' } }],
    },
    {
      id: 'zero-capacity-infeasible-target',
      group: 'diagnostic',
      heldOut: false,
      purpose: 'Diagnostic infeasibility separation: single window fully blocked by an opaque event; verifies proved shortfall + strict-target INFEASIBLE proof.',
      weeks: 1,
      avoidDates: [],
      knownFeasibleMinutes: [0],
      expectShortfall: true,
      profile: {
        student: 'diagnostic-infeasible',
        timezone: 'America/Sao_Paulo',
        targetHours: 2,
        maxDailyStudyHours: 2,
        studyBreakMinutes: 15,
        availabilityThrough: '2026-11-08',
        courses: [
          {
            name: 'Linear Algebra',
            deadline: '2026-12-01T18:00:00-03:00',
            source: 'diagnostic:Linear Algebra',
          },
        ],
        studyWindows: [{ weekday: 3, start: '19:00', end: '21:15' }],
      },
      events: [
        {
          id: 'blocking-lab',
          summary: 'Evening lab',
          start: { dateTime: '2026-11-04T18:30:00-03:00', timeZone: 'America/Sao_Paulo' },
          end: { dateTime: '2026-11-04T21:30:00-03:00', timeZone: 'America/Sao_Paulo' },
        },
      ],
      variants: [{ name: 'default', options: {} }],
    },
  ];

  const plannerSource = readFileSync(resolve(ROOT, 'src/domain/planner.mjs'));
  const cpsatSource = readFileSync(resolve(ROOT, 'experiments/planner-comparison/cpsat_planner.py'));

  return {
    schemaVersion: 1,
    clock: frozenRaw.clock,
    sessionMinutes: frozenRaw.sessionMinutes,
    slotMinutes: frozenRaw.slotMinutes,
    readinessBaseline: frozenRaw.baseline,
    hashes: {
      readinessCasesSha256: readiness.sha256,
      brunoCalendarSha256: brunoCalendar.sha256,
      anaCalendarSha256: anaCalendar.sha256,
      brunoReplayCaseSha256: brunoReplayCase.sha256,
      anaReplayCaseSha256: anaReplayCase.sha256,
      heuristicPlannerSha256: sha256(plannerSource),
      cpsatPlannerSha256: sha256(cpsatSource),
    },
    cases: [...frozenCases, ...pairedReplayCases, ...diagnosticCases],
  };
}
