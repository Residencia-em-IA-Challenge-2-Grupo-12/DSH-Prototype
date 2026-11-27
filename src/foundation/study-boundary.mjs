import {
  assertStudent,
  FIXED_TODAY,
  listWorkspace,
  readWorkspace,
  readWorkspacePageRange,
  runtimeDir,
  withSyntheticRuntime,
  draft,
  previewPlan,
  checkpoint,
  report,
  saveNarrative,
  readPlanningContext,
  proposePlanningContext,
} from '../core.mjs';
import { compactCalendarEvents } from './calendar-view.mjs';
import { createDisclosedSources, planningContextSchemaFor } from '../cold-start-context.mjs';

// Trusted application side of a single synthetic run. It deliberately exposes
// no approval, reset, raw provider, administration or calendar-write method.
export function createStudyBoundary({
  student,
  calendar,
  requireStaged = true,
  allowedStudents,
  schemaProfile = 'v1',
  disclosedSources = schemaProfile === 'eval-v2' ? createDisclosedSources() : undefined,
  coldStart = false,
  availabilityPreview,
  clock = { date: FIXED_TODAY, timezone: 'America/Sao_Paulo' },
} = {}) {
  assertStudent(student, allowedStudents);
  planningContextSchemaFor(schemaProfile);
  if (typeof requireStaged !== 'boolean') throw new Error('Workspace policy must be explicit');
  if (!calendar || typeof calendar.events !== 'function') throw new Error('A synthetic calendar is required');
  const simulationToday = clock?.date || FIXED_TODAY;
  const timezone = clock?.timezone || 'America/Sao_Paulo';
  const workspace = { requireStaged: requireStaged || schemaProfile === 'eval-v2', allowedStudents };
  const planning = { ...workspace, today: simulationToday, disclosedSources, schemaProfile };

  const methods = new Map([
    ['list_synthetic_files', args => listWorkspace(student, args.path || '', workspace)],
    ['read_synthetic_file', async ({ path, pageStart, pageEnd }) => {
      if (pageStart !== undefined || pageEnd !== undefined) {
        const result = await readWorkspacePageRange(student, path, { ...workspace, pageStart, pageEnd });
        for (const { page, text } of result.pages) disclosedSources?.disclose(path, text, page);
        return result;
      }
      const text = await readWorkspace(student, path, workspace);
      if (disclosedSources) {
        if (/\.pdf$/i.test(path)) {
          const pages = text.split('\f');
          if (pages.at(-1) === '') pages.pop();
          pages.forEach((body, index) => disclosedSources.disclose(path, body, index + 1));
        } else {
          disclosedSources.disclose(path, text);
        }
      }
      return text;
    }],
    ['list_calendar', async () => ({
      simulationToday,
      timezone,
      events: compactCalendarEvents(await calendar.events(student, { allowedStudents })),
    })],
    [
      'draft_study_plan',
      args =>
        draft(
          calendar,
          student,
          {
            weeks: args.weeks,
            hours: args.hours,
            avoidDates: args.avoidDates,
            preferredPeriod: args.preferredPeriod,
            focusCourse: args.focusCourse,
            ...(coldStart ? { allocation: args.allocation } : {}),
          },
          planning,
        ),
    ],
    [
      'preview_plan',
      args =>
        previewPlan(
          calendar,
          student,
          {
            weeks: args.weeks,
            hours: args.hours,
            avoidDates: args.avoidDates,
            preferredPeriod: args.preferredPeriod,
            focusCourse: args.focusCourse,
            record: args.record,
            ...(coldStart ? { allocation: args.allocation } : {}),
          },
          planning,
        ),
    ],
    ['inspect_checkpoint', args => checkpoint(calendar, student, args.reason || '')],
    ['routine_report', () => report(calendar, student, { today: simulationToday })],
    ['save_report_interpretation', args => saveNarrative(student, args.narrative)],
  ]);
  if (coldStart) {
    if (availabilityPreview) methods.set('preview_study_options', args => availabilityPreview.stage(args.options));
    methods.set('read_planning_context', async () => {
      const context = await readPlanningContext(student);
      return {
        pending: context.pending ?? null,
        confirmed: context.confirmed ?? null,
        previous: context.previous ?? null,
      };
    });
    methods.set('propose_planning_context', args => proposePlanningContext(student, args.record, planning));
  }

  return {
    methods: () => [...methods.keys()],
    async call(method, args) {
      if (!methods.has(method)) throw new Error('Agent operation is not available');
      if (!args || typeof args !== 'object' || Array.isArray(args) || args.student !== student) {
        throw new Error('Request does not match the selected synthetic student');
      }
      return withSyntheticRuntime(runtimeDir(), () => methods.get(method)(args), workspace);
    },
  };
}
