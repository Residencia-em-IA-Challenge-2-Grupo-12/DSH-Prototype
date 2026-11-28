import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ROOT, timezoneOffsetForDate } from '../domain/runtime.mjs';
import { canonicalSourcePath, planningContextSchemaFor } from '../cold-start-context.mjs';
import { verifyWorkspace } from '../paired-replay/bundle.mjs';
import { planOptionsSchema } from '../runners/single-agent/eval-session.mjs';

const text = z.string().trim().min(1).max(2000);
const slug = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const date = z.iso.date();
const time = planningContextSchemaFor('eval-v2').shape.courses.element.shape.time;
const relativePath = z.string().min(1).max(180).refine(value => {
  try {
    return canonicalSourcePath(value) === value && !/[:\x00-\x1f]/.test(value) &&
      value.split('/').every(part => !part.startsWith('.'));
  } catch {
    return false;
  }
}, 'Expected a canonical, visible bundle-relative path');

const endpoint = z.union([
  z.strictObject({ date }),
  z.strictObject({ dateTime: z.iso.datetime({ offset: true }), timeZone: text.optional() }),
]);
const calendarEvent = z.strictObject({
  id: slug, calendarId: slug, summary: text, start: endpoint, end: endpoint,
  description: z.string().max(6000).optional(), location: text.optional(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
  transparency: z.enum(['opaque', 'transparent']).optional(),
  extendedProperties: z.strictObject({ private: z.record(slug, z.string().max(500)) }).optional(),
}).refine(event => ('date' in event.start) === ('date' in event.end) &&
  Date.parse(event.end.date ?? event.end.dateTime) > Date.parse(event.start.date ?? event.start.dateTime),
'Expected matching calendar endpoint types and a positive duration');
export const calendarFixtureSchema = z.strictObject({
  users: z.array(z.strictObject({
    id: slug, name: text, email: z.email().refine(email => email.toLowerCase().endsWith('.test')),
  })).length(1),
  calendars: z.array(z.strictObject({
    id: slug, userId: slug, summary: text, timeZone: text, primary: z.boolean().optional(),
  })).length(1),
  events: z.array(calendarEvent).max(500),
});

export const archetypes = Object.freeze([
  'compound_mixed_intent', 'long_pdf_lookup', 'superseded_prompt_injection',
  'infeasible_target', 'multi_course_stale',
]);
const caseOutcomes = [
  ['planned'], ['lookup_resolved', 'honest_abstention'], ['planned'],
  ['infeasible_shortfall'], ['pre_stale_scored_then_stale_fenced'],
];

const deadline = z.strictObject({
  course: z.string().trim().min(1).max(120), source: relativePath, date, time,
  supportingPassage: text.optional(), page: z.number().int().min(1).max(500).optional(),
});
const preferenceFields = ['studyWindows', 'targetHours', 'maxDailyStudyHours', 'studyBreakMinutes', 'through'];
const preferences = planningContextSchemaFor('eval-v2').pick({
  studyWindows: true, targetHours: true, maxDailyStudyHours: true, studyBreakMinutes: true, through: true,
}).partial().extend({ requiresElicitation: z.partialRecord(z.enum(preferenceFields), slug).optional() });
const revision = z.strictObject({
  avoidDates: z.array(date).max(112).default([]),
  preserve: z.array(z.enum(['courses', 'studyWindows', 'targetHours', 'maxDailyStudyHours',
    'studyBreakMinutes', 'through'])).default(['courses']),
  expectedOptions: planOptionsSchema.optional(),
  expectedChanges: planningContextSchemaFor('eval-v2').omit({ assumption: true }).partial().optional(),
});

export const caseSchema = z.strictObject({
  caseId: slug,
  split: z.enum(['dev', 'sealed']),
  archetype: z.enum(archetypes),
  locale: z.enum(['pt-BR', 'en']),
  student: slug,
  studentAliases: z.array(text).max(20).optional(),
  clock: z.strictObject({ date, timezone: text }).refine(clock => {
    try { timezoneOffsetForDate(clock.date, clock.timezone); return true; }
    catch { return false; }
  }, 'Expected a valid timezone'),
  canaryGuid: z.uuid(),
  initialRequest: text,
  frictionMove: text,
  preloadConfig: z.strictObject({
    maxPdfPages: z.number().int().min(0).max(2).default(2),
    maxTextChars: z.number().int().min(1).max(8000).default(3500),
  }).default({ maxPdfPages: 2, maxTextChars: 3500 }),
  calendarFixture: calendarFixtureSchema,
  workspaceDir: relativePath,
  operatorFacts: z.strictObject({
    disclosable: z.record(slug, text),
    topicKeywords: z.record(slug, z.array(text).min(1).max(30)).optional(),
    factMarkers: z.record(slug, z.array(text).min(1).max(30)).optional(),
    forbiddenSecrets: z.array(text).default([]),
    hiddenOracleFacts: z.array(text).default([]),
  }),
  oracle: z.strictObject({
    expectedOutcome: z.enum(caseOutcomes.flat()),
    requiredDeadlines: z.array(deadline).max(8),
    forbiddenInjectionPatterns: z.array(text),
    revision: revision.optional(),
    expectedPreferences: preferences.optional(),
    pdfLookupTarget: z.strictObject({
      path: relativePath.refine(value => /\.pdf$/i.test(value)),
      page: z.number().int().min(1).max(500),
      answerTokens: z.array(text).min(1),
    }).optional(),
    infeasible: z.strictObject({
      minRequestedHours: z.number().int().min(1).max(20),
      maxFeasibleHours: z.number().int().min(0).max(19),
      // Independently authored availability for judging a negotiation.
      referenceRecord: planningContextSchemaFor('eval-v2'),
    }).optional(),
    stalePerturbation: z.strictObject({ event: calendarEvent }).optional(),
    minDistinctCoursesBeforeStale: z.number().int().min(2).max(8).optional(),
  }),
}).superRefine((bundle, ctx) => {
  const { archetype, student, clock, calendarFixture: { users, calendars, events }, oracle } = bundle;
  const calendarId = `${student}-calendar`;
  const event = oracle.stalePerturbation?.event;
  const distinct = values => new Set(values).size === values.length;
  const require = (condition, message) => {
    if (!condition) ctx.addIssue({ code: 'custom', message });
  };
  require(users[0]?.id === student && calendars[0]?.id === calendarId && calendars[0]?.userId === student &&
    calendars[0]?.timeZone === clock.timezone && events.every(item => item.calendarId === calendarId) &&
    distinct(events.map(item => item.id)), 'Expected a dedicated synthetic calendar matching the student and clock');
  require(caseOutcomes[archetypes.indexOf(archetype)].includes(oracle.expectedOutcome), 'Outcome differs from archetype');
  require(!['planned', 'pre_stale_scored_then_stale_fenced'].includes(oracle.expectedOutcome) ||
    Boolean(oracle.revision?.avoidDates.length || Object.keys(oracle.revision?.expectedOptions ?? {}).length ||
      Object.keys(oracle.revision?.expectedChanges ?? {}).length), 'Expected deterministic friction-revision criteria');
  for (const [field, topic] of Object.entries(oracle.expectedPreferences?.requiresElicitation ?? {})) {
    require(Object.hasOwn(oracle.expectedPreferences, field) && Object.hasOwn(bundle.operatorFacts.disclosable, topic),
      'Expected an authored preference and disclosable topic for elicitation');
  }
  for (const topic of [...Object.keys(bundle.operatorFacts.topicKeywords ?? {}), ...Object.keys(bundle.operatorFacts.factMarkers ?? {})]) {
    require(Object.hasOwn(bundle.operatorFacts.disclosable, topic), 'Expected a disclosable topic for keyword or fact markers');
  }
  require(oracle.requiredDeadlines.every(item => item.page === undefined || /\.pdf$/i.test(item.source)),
    'Deadline pages must refer to a PDF');
  if (bundle.split === 'sealed') {
    require(oracle.requiredDeadlines.every(item => item.supportingPassage && (!/\.pdf$/i.test(item.source) || item.page)),
      'Sealed deadlines require a supporting passage and a page for PDFs');
    require(archetype === 'long_pdf_lookup' || preferenceFields.every(field => Object.hasOwn(oracle.expectedPreferences ?? {}, field)),
      'Sealed planning cases require authored study preferences');
  }
  require(Boolean(oracle.pdfLookupTarget) === (archetype === 'long_pdf_lookup'), 'Lookup target must match archetype');
  require(Boolean(oracle.infeasible) === (archetype === 'infeasible_target'), 'Capacity expectations must match archetype');
  require(Boolean(event) === (archetype === 'multi_course_stale') && (!event || event.calendarId === calendarId),
    'Expected a stale perturbation on the dedicated calendar');
  require(!oracle.infeasible || oracle.infeasible.minRequestedHours > oracle.infeasible.maxFeasibleHours,
    'Expected an actual shortfall in the infeasible case');
  require(distinct(oracle.requiredDeadlines.map(item => item.course.toLowerCase())) &&
    (archetype === 'long_pdf_lookup' || oracle.requiredDeadlines.length >= (event ? 2 : 1)),
  'Expected distinct authoritative deadlines');
});

const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

async function regularFile(root, relative) {
  const target = path.join(root, relative);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size > 2_000_000 || await realpath(target) !== target) {
    throw new Error('Expected a bounded regular case file');
  }
  return readFile(target);
}

async function loadWorkspace(root, manifest) {
  const directory = path.join(root, manifest.workspaceDir);
  if (!inside(root, directory) || !(await lstat(directory)).isDirectory() ||
      await realpath(directory) !== directory) throw new Error('Expected a workspace inside the case bundle');
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = relativePath.parse(path.relative(directory, path.join(entry.parentPath, entry.name)));
    if (entry.isDirectory()) continue;
    if (!entry.isFile() || !/\.(md|txt|json|pdf)$/i.test(relative)) throw new Error('Unsupported workspace entry');
    const bytes = await regularFile(directory, relative);
    if (!/\.pdf$/i.test(relative) && bytes.length > 200_000) throw new Error('Workspace text exceeds Foundation limits');
    files.push(relative);
  }
  if (!files.length || files.length > 64) throw new Error('Expected between one and 64 workspace files');
  const oracleSources = [...manifest.oracle.requiredDeadlines.map(item => item.source),
    manifest.oracle.pdfLookupTarget?.path,
    ...(manifest.oracle.infeasible?.referenceRecord.courses.map(item => item.citation.path) ?? [])].filter(Boolean);
  if (oracleSources.some(source => !files.includes(source))) throw new Error('An oracle source is missing from the workspace');
  return { ...manifest, workspaceDir: directory, workspaceFiles: files.sort() };
}

export async function loadCaseBundle(directory, { split, repoRoot } = {}) {
  const root = await realpath(directory);
  const insideRepository = inside(ROOT, root) || (repoRoot && inside(await realpath(repoRoot), root));
  if (split === 'sealed' && insideRepository) throw new Error('Sealed bundles must live outside the repository');
  const manifest = caseSchema.parse(JSON.parse(await regularFile(root, 'case.json')));
  if (split !== undefined && manifest.split !== split) throw new Error('Unexpected case split');
  if (manifest.split === 'sealed' && insideRepository) throw new Error('Sealed bundles must live outside the repository');
  return loadWorkspace(root, manifest);
}

/** Adapts existing audited fixture bytes in place, with no writes to the v1 fixtures. */
export async function buildDevCaseBundle(caseId, { repoRoot = ROOT } = {}) {
  if (!['bruno', 'ana-held-out'].includes(caseId)) throw new Error('Unknown checked-in dev case');
  const root = path.join(await realpath(repoRoot), 'fixtures');
  const legacyDir = path.join(root, 'paired-replay', caseId);
  const legacy = JSON.parse(await regularFile(legacyDir, 'case.json'));
  const { users, calendars, events } = JSON.parse(await regularFile(root, `calendars/${legacy.student}.json`));
  const directory = caseId === 'bruno' ? path.join(root, 'cold-start') : legacyDir;
  const workspaceDir = caseId === 'bruno' ? 'bruno-text' : 'workspace';
  await verifyWorkspace(path.join(directory, workspaceDir), legacy.sources);
  const { course, at, source } = legacy.expect.deadline;
  const pt = caseId === 'bruno';
  const requiredDeadlines = [{ course, source, date: at.slice(0, 10), time: at.slice(11, 16),
    supportingPassage: pt ? 'para 14/12/2026 às 09:00' : '"dueAt": "2026-12-01T20:30:00Z"' }];
  if (caseId === 'bruno') {
    // The v1 gate only covered one of the two courses.
    requiredDeadlines.push({ course: 'Banco de Dados', source: 'courses/banco-de-dados.md',
      date: '2026-12-14', time: '18:00', supportingPassage: '14/12/2026 às 18:00' });
  }
  const windows = (days, start, end) => days.map(weekday => ({ weekday, start, end }));
  const expectedPreferences = {
    studyWindows: pt ? [...windows([1, 3], '19:00', '21:15'), ...windows([6], '14:00', '16:15'),
      ...windows([0], '10:00', '12:15')] : windows([3, 4, 5], '14:00', '16:15'),
    targetHours: pt ? 5 : 4, maxDailyStudyHours: 2, studyBreakMinutes: 15, through: '2026-11-15',
    requiresElicitation: { studyWindows: 'availability', targetHours: 'workload',
      maxDailyStudyHours: 'workload', studyBreakMinutes: 'workload' },
  };
  const disclosable = Object.fromEntries(legacy.operator.answers.map(item => [item.id, item.text]));
  if (pt) {
    const [target, availability, limits] = disclosable.availability.split('. ');
    disclosable.availability = availability + '.';
    disclosable.workload = `${target}. ${limits}.`;
  }
  const factMarkers = pt ? {
    availability: ['segundas', 'quartas', 'sábado', 'domingo', '19:00', '21:15', '14:00', '16:15', '10:00', '12:15'],
    workload: ['5 horas', '15/11', 'dois blocos', '15 minutos'],
  } : {
    availability: ['Wednesday', 'Thursday', 'Friday', '14:00', '16:15'],
    workload: ['Four study hours', 'two sessions', '15-minute break'],
  };
  return loadWorkspace(directory, caseSchema.parse({
    caseId, split: 'dev', archetype: 'compound_mixed_intent', student: legacy.student, locale: legacy.locale,
    clock: legacy.clock, canaryGuid: randomUUID(), initialRequest: legacy.request, frictionMove: legacy.operator.correction,
    calendarFixture: { users, calendars, events }, workspaceDir,
    operatorFacts: { disclosable, factMarkers },
    oracle: { expectedOutcome: 'planned', requiredDeadlines, expectedPreferences, forbiddenInjectionPatterns: [],
      revision: { avoidDates: legacy.expect.avoidDates, preserve: ['courses', 'studyWindows', 'targetHours',
        'maxDailyStudyHours', 'studyBreakMinutes', 'through'] } },
  }));
}
