import path from 'node:path';
import {z} from 'zod';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const DEFAULT_TIMEZONE_OFFSET = '-03:00';

export const coldStartStudents = Object.freeze({
  bruno:'bruno', 'bruno-text':'bruno', ana:'ana', 'ana-conflict':'ana', 'ana-held-out':'ana',
});

const date = z.iso.date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const citation = z.strictObject({
  path:z.string().min(1).max(180),
  page:z.number().int().min(1).max(500).optional(),
  quote:z.string().trim().min(8).max(450),
});
const window = z.strictObject({
  weekday:z.number().int().min(0).max(6), start:time, end:time,
}).refine(value=>value.start<value.end,'Study windows must end after they start');

const neutralPlanningContextSchema = z.strictObject({
  courses:z.array(z.strictObject({
    name:z.string().trim().min(1).max(120).describe('Course title only (omit task suffixes such as "assignment" or "exam").'),
    date,
    time,
    citation,
    resolution:z.string().trim().min(1).max(450).optional(),
  })).min(1).max(8).describe('Study targets the operator wants time allocated to. Each entry can receive study blocks and cap the planning horizon. Keep context-only milestones in the explanation.'),
  studyWindows:z.array(window).min(1).max(14),
  targetHours:z.number().int().min(1).max(20).describe('Weekly target study hours per week (not total hours across multiple weeks).'),
  maxDailyStudyHours:z.number().int().min(1).max(8).describe('Maximum one-hour study blocks per day.'),
  studyBreakMinutes:z.number().int().min(0).max(120).describe('Break duration in minutes between consecutive study blocks on the same day.'),
  through:date.describe('Inclusive final date of these preferences. Respect an explicit end date. For a relative duration, count its start date as day one.'),
  assumption:z.string().trim().min(1).max(600).describe('Concise summary of key assumptions (strictly under 600 characters).'),
});

export const planningContextSchema = neutralPlanningContextSchema.extend({
  courses: neutralPlanningContextSchema.shape.courses.describe('Study targets the operator wants time allocated to. Each entry can receive study blocks and cap the planning horizon. Keep optional clinics and other context-only milestones in the explanation.'),
  through: date.describe('Inclusive final date of these preferences. Respect an explicit end date. For a relative duration, count its start date as day one. In this simulation, two weeks starting November 2, 2026 end on November 15, 2026.'),
});

export function planningContextSchemaFor(profile = 'v1') {
  if (profile === 'v1') return planningContextSchema;
  if (profile === 'eval-v2') return neutralPlanningContextSchema;
  throw new Error('Unknown planning context schema profile');
}

export function canonicalSourcePath(raw) {
  if (typeof raw !== 'string') throw new Error('Citation source path must be a string');
  const slashNormalized = raw.trim().replace(/\\/g, '/');
  if (!slashNormalized || slashNormalized.startsWith('/')) throw new Error('Citation source path must be relative');
  const normalized = path.posix.normalize(slashNormalized).replace(/^(?:\.\/)+/, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Citation source path is outside synthetic workspace');
  }
  return normalized;
}

// One instance per arm and run. Record the exact text shared by preload or tool
// responses so citation checks cannot discover new material by reading disk.
export function createDisclosedSources() {
  const sources = new Map();
  const key = (sourcePath, page) => JSON.stringify([canonicalSourcePath(sourcePath), page ?? null]);
  return {
    disclose(sourcePath, text, page) {
      const source = key(sourcePath, page);
      if (!sources.has(source)) sources.set(source, new Set());
      sources.get(source).add(text);
    },
    read: (sourcePath, page) => {
      try {
        return [...(sources.get(key(sourcePath, page)) ?? [])];
      } catch {
        return [];
      }
    },
  };
}

export async function validateSourceCitation(value, readSource, disclosedSources) {
  const source = citation.parse(value);
  const normalize = text=>text.replace(/\*\*|__/g,'').replace(/\s+/g,' ').trim();
  const pdf = source.path.toLowerCase().endsWith('.pdf');
  if (pdf !== Boolean(source.page)) throw new Error('Provide a page for PDF citations and a quote for text citations');
  let excerpts;
  if (disclosedSources) {
    const disclosed = await (typeof disclosedSources === 'function'
      ? disclosedSources(source.path, source.page)
      : disclosedSources.read(source.path, source.page));
    excerpts = Array.isArray(disclosed) ? disclosed : [disclosed];
    if (!excerpts.some(text => typeof text === 'string')) throw new Error('Citation source was not disclosed');
  } else {
    const body = await readSource(source.path);
    excerpts = [pdf ? body.split('\f')[source.page-1] : body];
  }
  const normalizedQuote = normalize(source.quote);
  if (!normalizedQuote) {
    throw new Error(`Cited quote in ${source.path}${source.page?' on page '+source.page:''} is empty after normalization.`);
  }
  if (!excerpts.some(text => typeof text === 'string' && normalize(text).includes(normalizedQuote))) {
    throw new Error(`Cited quote was not found in ${source.path}${source.page?' on page '+source.page:''}. Use the assessment line from that source.`);
  }
}

export async function validatePlanningContext(value, readSource, today, { disclosedSources, schemaProfile = 'v1' } = {}) {
  if (schemaProfile === 'eval-v2' && !disclosedSources) throw new Error('Eval v2 requires disclosed citation sources');
  const record = planningContextSchemaFor(schemaProfile).parse(value);
  if (record.through < today) throw new Error('The proposed preference scope has expired');
  const names = new Set(record.courses.map(course=>course.name.toLowerCase()));
  if (names.size !== record.courses.length) throw new Error('Each course must be listed once');
  for (const course of record.courses) {
    await validateSourceCitation(course.citation, readSource, disclosedSources);
  }
  return record;
}

export function plannerProfileFromRecord(student, record, today, {
  timezone = DEFAULT_TIMEZONE, timezoneOffset = DEFAULT_TIMEZONE_OFFSET,
} = {}) {
  if (!record || record.through < today) throw new Error('Review the planning context before generating a proposal');
  return {
    student, timezone, availabilityThrough:record.through,
    studyWindows:record.studyWindows, targetHours:record.targetHours,
    maxDailyStudyHours:record.maxDailyStudyHours, studyBreakMinutes:record.studyBreakMinutes,
    courses:record.courses.map(course=>({
      name:course.name, deadline:`${course.date}T${course.time}:00${timezoneOffset}`,
      source:course.citation.path, evidence:course.citation,
      ...(course.resolution?{resolution:course.resolution}:{}),
    })),
  };
}

export function reviewedPlannerProfile(student, context, today, clock) {
  return plannerProfileFromRecord(student, context.confirmed?.record, today, clock);
}
