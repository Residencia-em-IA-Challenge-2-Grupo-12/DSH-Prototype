import { z } from 'zod';
import { planningContextSchema } from '../../cold-start-context.mjs';
import { availabilityOptions } from '../../foundation/availability-preview.mjs';

const askUserQuestionSchema = z.strictObject({
  requestId: z.string().min(1).max(120).optional(),
  questions: z.array(z.strictObject({
    id: z.string().min(1).max(120),
    groupId: z.string().min(1).max(120).optional(),
    question: z.string().min(1).max(2000),
    options: z.array(z.strictObject({
      label: z.string().min(1).max(200),
      description: z.string().max(400).optional(),
    })).default([]),
  })).min(1).max(6),
});

const BRIDGE_TOOL_SCHEMAS = {
  list_synthetic_files: {
    description: 'List files inside the selected synthetic student workspace.',
    schema: z.strictObject({ path: z.string().max(180).optional() }),
  },
  read_synthetic_file: {
    description: 'Read a text, JSON, Markdown, or PDF file from the selected synthetic workspace.',
    schema: z.strictObject({ path: z.string().min(1).max(180) }),
  },
  list_calendar: {
    description: 'Read the synthetic calendar events and simulation clock. Never assume real accounts are connected.',
    schema: z.strictObject({}),
  },
  read_planning_context: {
    description: 'Read pending and operator-confirmed planning context for this run.',
    schema: z.strictObject({}),
  },
  propose_planning_context: {
    description: 'Submit normalized course deadlines, verbatim source citations (with PDF page when applicable), and study availability for separate operator review. Use weekdays 0 (Sunday) through 6 (Saturday). For conflicting sources, record the operator’s resolution. Include targetHours, maxDailyStudyHours, studyBreakMinutes, through date, and important assumptions. Produces a pending record only.',
    schema: z.strictObject({ record: planningContextSchema }),
  },
  draft_study_plan: {
    description: 'Create or revise a reviewable study proposal in one-hour blocks using operator-confirmed inputs. Pass weeks (e.g. 2) and optional avoidDates/preferredPeriod/focusCourse; leave weekly target hours to the confirmed record. Does not write to the calendar.',
    schema: z.strictObject({
      weeks: z.number().int().min(1).max(16).optional(),
      avoidDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(112).optional(),
      preferredPeriod: z.enum(['morning', 'afternoon', 'evening']).optional(),
      focusCourse: z.string().max(200).optional(),
      allocation: z.enum(['course-coverage']).optional(),
    }),
  },
  preview_study_options: {
    description: 'Check candidate study windows against existing calendar commitments before offering concrete time options.',
    schema: z.strictObject({ options: availabilityOptions }),
  },
  inspect_checkpoint: {
    description: 'Compare the current synthetic calendar with the last saved snapshot and preserve user edits.',
    schema: z.strictObject({ reason: z.string().max(400).optional() }),
  },
  routine_report: {
    description: 'Compute deterministic routine metrics from the synthetic calendar and optional feedback.',
    schema: z.strictObject({}),
  },
  save_report_interpretation: {
    description: 'Save a source-grounded explanation of routine_report metrics without claiming completion from scheduled time.',
    schema: z.strictObject({ narrative: z.string().min(1).max(12000) }),
  },
};

export const SCHEMA_COMPAT_MODES = ['standard', 'gemini'];

export function stripAdditionalProperties(node) {
  if (Array.isArray(node)) return node.map(stripAdditionalProperties);
  if (!node || typeof node !== 'object') return node;
  const cleaned = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties') continue;
    cleaned[key] = stripAdditionalProperties(value);
  }
  return cleaned;
}

function toParameters(schema, schemaCompat = 'standard') {
  if (!SCHEMA_COMPAT_MODES.includes(schemaCompat)) {
    throw new Error(`Unsupported schemaCompat mode: ${schemaCompat} (expected one of ${SCHEMA_COMPAT_MODES.join(', ')})`);
  }
  const jsonSchema = z.toJSONSchema(schema);
  delete jsonSchema.$schema;
  return schemaCompat === 'gemini' ? stripAdditionalProperties(jsonSchema) : jsonSchema;
}

export function buildOpenAITools(allowedMethods = [], { schemaCompat = 'standard' } = {}) {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'ask_user_question',
        description: 'Ask the operator one or more concrete clarification questions when material preferences or conflicting deadlines are unresolved.',
        parameters: toParameters(askUserQuestionSchema, schemaCompat),
      },
    },
  ];
  for (const method of allowedMethods) {
    const spec = BRIDGE_TOOL_SCHEMAS[method];
    if (!spec) continue;
    tools.push({
      type: 'function',
      function: {
        name: method,
        description: spec.description,
        parameters: toParameters(spec.schema, schemaCompat),
      },
    });
  }
  return tools;
}

export function parseAskUserQuestionArgs(rawArgs) {
  return askUserQuestionSchema.parse(rawArgs);
}

export function buildSystemPrompt({ student, clock, locale }) {
  const languageHint = locale === 'pt-BR' ? 'Brazilian Portuguese (pt-BR)' : 'English';
  return [
    `You are a collaborative study-planning assistant for synthetic student "${student}".`,
    `Simulation clock: today is ${clock.date} in timezone ${clock.timezone}. Interpret all dates relative to this clock, not the host clock.`,
    `Respond in ${languageHint}.`,
    'Inspect the workspace files and synthetic calendar first before proposing a plan. Distinguish superseded dates from authoritative deadlines, quote the authoritative source verbatim (with PDF page when applicable), and keep optional clinics or context-only milestones in your explanation rather than courses.',
    'Ask only about material missing or conflicting decisions using ask_user_question. Study blocks are always 1 hour each (so N sessions/day corresponds to maxDailyStudyHours: N). Once sources and operator inputs determine a feasible plan, submit those normalized inputs directly via propose_planning_context (weekdays are 0=Sunday through 6=Saturday; use the exact course title for courses[].name without task suffixes; keep assumption concise and under 600 characters; its review is the confirmation step — skip extra yes/no questions about resolved facts).',
    'Wait for separate operator confirmation of the pending planning context before calling draft_study_plan. When the operator requests a correction (such as removing a weekday or changing availability/deadlines), reuse confirmed inputs for unchanged fields, submit the updated record via propose_planning_context for review, and wait for confirmation before drafting.',
    'Never attempt to write to the calendar directly; calendar approval happens through separate trusted controls.',
  ].join(' ');
}
