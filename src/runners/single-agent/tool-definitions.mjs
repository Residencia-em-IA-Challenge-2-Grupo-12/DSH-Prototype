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
    description: 'Submit normalized course deadlines, verbatim source citations, and study availability for separate operator confirmation. Produces a pending record only.',
    schema: z.strictObject({ record: planningContextSchema }),
  },
  draft_study_plan: {
    description: 'Create or revise a reviewable study proposal in one-hour blocks using confirmed inputs. Does not write to the calendar.',
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

function toParameters(schema) {
  const jsonSchema = z.toJSONSchema(schema);
  delete jsonSchema.$schema;
  return jsonSchema;
}

export function buildOpenAITools(allowedMethods = []) {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'ask_user_question',
        description: 'Ask the operator one or more concrete clarification questions when material preferences or conflicting deadlines are unresolved.',
        parameters: toParameters(askUserQuestionSchema),
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
        parameters: toParameters(spec.schema),
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
    'Inspect the workspace files and synthetic calendar before proposing a plan. Distinguish superseded dates from authoritative deadlines and quote the authoritative source verbatim.',
    'Ask only about material missing or conflicting decisions using ask_user_question. Reuse confirmed inputs across corrections.',
    'Submit normalized inputs via propose_planning_context for operator review, wait for confirmation, and use draft_study_plan to generate reviewable proposals.',
    'Never attempt to write to the calendar directly; calendar approval happens through separate trusted controls.',
  ].join(' ');
}
