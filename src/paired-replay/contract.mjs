import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const sourcePath = z.string().max(180).regex(/^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(8000);
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const section = z.enum(['near', 'future']);
const student = z.enum(['ana', 'bruno']);

export const inputSchema = z.strictObject({
  version: z.literal(1), id, student, locale: z.enum(['en', 'pt-BR']),
  clock: z.strictObject({ date, timezone: z.string().min(1).max(80) }),
  calendar: z.strictObject({ student, sha256: hash }),
  sources: z.array(z.strictObject({ path: sourcePath, sha256: hash })).min(1).max(32),
  request: text,
  operator: z.strictObject({ answers: z.array(z.strictObject({ id, text })).min(1).max(20), correction: text, approval: section }),
  expect: z.strictObject({
    deadline: z.strictObject({ course: text, at: timestamp, source: sourcePath }),
    avoidDates: z.array(date).max(112),
  }),
});

const citation = z.strictObject({ path: sourcePath, quote: text, page: z.number().int().positive().optional() });
const action = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('add'), eventId: id, label: text, course: text, start: timestamp, end: timestamp }),
  z.strictObject({ kind: z.literal('remove'), eventId: id }),
]);
const observation = z.discriminatedUnion('availability', [
  z.strictObject({ availability: z.literal('available'), eventCount: z.number().int().nonnegative(),
    added: z.array(id), removed: z.array(id), changed: z.array(id) }),
  z.strictObject({ availability: z.literal('unavailable') }),
]);
const timeline = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('request'), text }),
  z.strictObject({ kind: z.literal('question'), id, text, choices: z.array(text) }),
  z.strictObject({ kind: z.literal('answer'), questionId: id, text }),
  z.strictObject({ kind: z.literal('advice'), text, sources: z.array(citation) }),
  z.strictObject({ kind: z.literal('context_review'), revisionId: id }),
  z.strictObject({ kind: z.literal('proposal'), revisionId: id, replaces: id.nullable(),
    sources: z.array(z.strictObject({ course: text, deadline: timestamp, citation })), assumptions: z.array(text),
    sections: z.strictObject({ near: z.array(action), future: z.array(action) }) }),
  z.strictObject({ kind: z.literal('validation'), revisionId: id, passed: z.boolean(), findings: z.array(text) }),
  z.strictObject({ kind: z.literal('decision'), revisionId: id, section, approved: z.boolean() }),
  z.strictObject({ kind: z.literal('write'), revisionId: id, section,
    outcome: z.enum(['applied', 'rejected', 'partial', 'unknown']),
    intended: z.array(id), acknowledged: z.array(id), unresolved: z.array(id), reason: text.optional() }),
  z.strictObject({ kind: z.literal('observation'), phase: z.enum(['initial', 'review', 'before_approval', 'after_approval']), value: observation }),
]);

export const resultSchema = z.strictObject({
  version: z.literal(1), caseId: id, inputSha256: hash, runId: id,
  engine: z.strictObject({ name: text, revision: text, mode: z.enum(['scripted', 'live']),
    model: text.nullable(), harness: text.nullable(), tools: z.array(text), simulator: text.nullable() }),
  durationMs: z.number().int().nonnegative(),
  usage: z.discriminatedUnion('availability', [
    z.strictObject({ availability: z.literal('unknown') }),
    z.strictObject({ availability: z.literal('not_applicable') }),
    z.strictObject({ availability: z.literal('available'), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
  ]),
  timeline: z.array(timeline),
  checks: z.array(z.strictObject({ id, outcome: z.enum(['pass', 'fail', 'not_observed']), detail: text })),
  retirement: z.enum(['verified', 'blocked', 'not_observed']),
});

export function jsonSchemas() {
  return { input: z.toJSONSchema(inputSchema), result: z.toJSONSchema(resultSchema) };
}
