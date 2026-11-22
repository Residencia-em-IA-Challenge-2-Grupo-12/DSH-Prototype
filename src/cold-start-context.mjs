import {z} from 'zod';

export const coldStartStudents = Object.freeze({
  bruno:'bruno', 'bruno-text':'bruno', ana:'ana', 'ana-conflict':'ana', 'ana-held-out':'ana',
});

const date = z.iso.date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const citation = z.strictObject({
  path:z.string().min(1).max(180),
  page:z.number().int().min(1).max(100).optional(),
  quote:z.string().trim().min(8).max(450),
});
const window = z.strictObject({
  weekday:z.number().int().min(0).max(6), start:time, end:time,
}).refine(value=>value.start<value.end,'Study windows must end after they start');

export const planningContextSchema = z.strictObject({
  courses:z.array(z.strictObject({
    name:z.string().trim().min(1).max(120),
    date,
    time,
    citation,
    resolution:z.string().trim().min(1).max(450).optional(),
  })).min(1).max(8).describe('Study targets the operator wants time allocated to. Each entry can receive study blocks and cap the planning horizon. Keep optional clinics and other context-only milestones in the explanation.'),
  studyWindows:z.array(window).min(1).max(14),
  targetHours:z.number().int().min(1).max(20),
  maxDailyStudyHours:z.number().int().min(1).max(8),
  studyBreakMinutes:z.number().int().min(0).max(120),
  through:date.describe('Inclusive final date of these preferences. Respect an explicit end date. For a relative duration, count its start date as day one. In this simulation, two weeks starting November 2, 2026 end on November 15, 2026.'),
  assumption:z.string().trim().min(1).max(600),
});

export async function validatePlanningContext(value, readSource, today) {
  const record = planningContextSchema.parse(value);
  if (record.through < today) throw new Error('The proposed preference scope has expired');
  const names = new Set(record.courses.map(course=>course.name.toLowerCase()));
  if (names.size !== record.courses.length) throw new Error('Each course must be listed once');
  const normalize = text=>text.replace(/\*\*|__/g,'').replace(/\s+/g,' ').trim();
  for (const {citation:source} of record.courses) {
    const body = await readSource(source.path);
    const pdf = source.path.toLowerCase().endsWith('.pdf');
    if (pdf !== Boolean(source.page)) throw new Error('Provide a page for PDF citations and a quote for text citations');
    const excerpt = pdf ? body.split('\f')[source.page-1] : body;
    if (!excerpt || !normalize(excerpt).includes(normalize(source.quote))) {
      throw new Error(`Cited quote was not found in ${source.path}${source.page?' on page '+source.page:''}. Use the assessment line from that source.`);
    }
  }
  return record;
}

export function reviewedPlannerProfile(student, context, today) {
  const record = context.confirmed?.record;
  if (!record || record.through < today) throw new Error('Review the planning context before generating a proposal');
  return {
    student, timezone:'America/Sao_Paulo', availabilityThrough:record.through,
    studyWindows:record.studyWindows, targetHours:record.targetHours,
    maxDailyStudyHours:record.maxDailyStudyHours, studyBreakMinutes:record.studyBreakMinutes,
    courses:record.courses.map(course=>({
      name:course.name, deadline:`${course.date}T${course.time}:00-03:00`,
      source:course.citation.path, evidence:course.citation,
      ...(course.resolution?{resolution:course.resolution}:{}),
    })),
  };
}
