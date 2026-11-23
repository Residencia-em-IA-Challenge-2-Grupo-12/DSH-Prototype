import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXED_TODAY, makePlan } from '../../src/core.mjs';
import { decideRoutinePreference } from './decision.mjs';
import { measurePlan } from '../planner-readiness/baseline.mjs';

const bytes = readFileSync(new URL('./cases.json', import.meta.url));
const fixture = JSON.parse(bytes);
const hash = value => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
const rules = 'This is a synthetic comparison. Use the packet as the only input and respond without tool calls. Prefer the stated target and honor confirmed limits. Use the dated statement to decide whether a restriction is hard, flexible, current, or expired. Use only the supplied candidates. Recommend one when the statement resolves the choice. Ask one focused question using two candidate IDs when a material tradeoff is open. Explain it with actual study and Wednesday minutes. Return only JSON with caseId (the supplied case identifier), action (recommend or ask), candidateIds (array), and message (string).';

const expected = {
  'no-cost': { action: 'recommend', candidates: ['protect-wednesday'] },
  'needs-choice': { action: 'ask', candidates: ['protect-wednesday', 'one-hour-wednesday'] },
  'bounded-fallback': { action: 'recommend', candidates: ['one-hour-wednesday'] },
  'hard-limit': { action: 'recommend', candidates: ['protect-wednesday'] },
  expired: { action: 'recommend', candidates: ['flexible', 'one-hour-wednesday'], any: true },
};

function frozenJSON(reference) {
  const source = readFileSync(resolve(root, reference.path));
  assert.equal(hash(source), reference.sha256, 'Frozen source changed');
  return JSON.parse(source);
}

function scenario(id) {
  const data = fixture.cases.find(item => item.id === id);
  if (!data) throw new Error('Unknown case ' + id);
  assert.equal(FIXED_TODAY, fixture.clock.date, 'Simulation date differs from the frozen case');
  const profile = frozenJSON(fixture.profile);
  profile.targetHours = fixture.week.targetHours;
  profile.availabilityThrough = fixture.week.through;
  profile.studyWindows = profile.studyWindows.filter(window => window.weekday !== 1);
  const events = frozenJSON(fixture.calendar).events;
  if (data.sundayChange) events.push(fixture.changedEvent);
  const date = fixture.week.wednesdayDate;
  const hard = data.formPreference === 'hard' && data.validThrough >= fixture.clock.date;
  const filters = [
    ['flexible', profile, []],
    ['protect-wednesday', profile, [date]],
    ['one-hour-wednesday', {
      ...profile, studyWindows: profile.studyWindows.map(window =>
        window.weekday === 3 ? { ...window, end: '20:00' } : window),
    }, []],
  ];
  const common = { profile, weeks: 1, avoidDates: hard ? [date] : [] };
  const candidates = filters.filter(([policy]) => !hard || policy === 'protect-wednesday')
    .map(([policy, candidateProfile, avoidDates]) => {
      const plan = makePlan(candidateProfile, events, { weeks: 1, avoidDates });
      const metrics = measurePlan(plan, events, { clock: fixture.clock, scenario: common, sessionMinutes: 60, slotMinutes: 15 });
      assert.deepEqual(metrics.findings, [], policy + ' failed independent validation');
      const blocks = plan.near.map(block => ({
        start: block.start.dateTime, end: block.end.dateTime, course: block.extendedProperties.private.course,
      })).sort((left, right) => left.start.localeCompare(right.start));
      const studyMinutes = metrics.scheduledMinutesByWeek[0];
      return { id: policy, studyMinutes, shortfallMinutes: profile.targetHours * 60 - studyMinutes,
        wednesdayMinutes: blocks.filter(block => block.start.startsWith(date)).length * 60,
        perCourseMinutes: metrics.perCourse, blocks };
    });
  return { data, candidates };
}

export function packet(id) {
  const { data, candidates } = scenario(id);
  return { caseId: data.responseId, fixtureSha256: hash(bytes), clock: fixture.clock, week: fixture.week,
    statement: data.statement, candidates, responseInstructions: rules };
}

export function formControl(id) {
  const { data, candidates } = scenario(id);
  const preference = {
    kind: data.formPreference,
    validFrom: '2026-10-26',
    validThrough: data.validThrough,
    fallbackMinutes: data.fallbackMinutes,
  };
  const { action, candidateIds } = decideRoutinePreference(candidates.map(candidate => ({
    ...candidate, protectedMinutes: candidate.wednesdayMinutes,
  })), preference, fixture.clock.date);
  return { action, candidateIds };
}

export function score(id, response) {
  const { data, candidates } = scenario(id);
  const answer = expected[id];
  const known = new Set(candidates.map(candidate => candidate.id));
  const { caseId, action, candidateIds, message } = response ?? {};
  if (caseId !== data.responseId || !['recommend', 'ask'].includes(action) || !Array.isArray(candidateIds) ||
      candidateIds.length !== (action === 'ask' ? 2 : 1) ||
      candidateIds.some(choice => !known.has(choice)) || new Set(candidateIds).size !== candidateIds.length ||
      typeof message !== 'string' || !message.trim() || message.length > 1500) {
    throw new Error('Response must include the case ID, a valid action, candidate IDs and a short message');
  }
  const correct = action === answer.action && (answer.any
    ? answer.candidates.includes(candidateIds[0])
    : [...candidateIds].sort().join('|') === [...answer.candidates].sort().join('|'));
  return { caseId: id, fixtureSha256: hash(bytes), actionAndCandidates: correct ? 'pass' : 'fail',
    explanationReview: 'pending', selected: candidates.filter(candidate => candidateIds.includes(candidate.id)) };
}

function main([command, id, file]) {
  if (command === 'packet' && id && !file) return packet(id);
  if (command === 'control' && id && !file) return formControl(id);
  if (command === 'score' && id && file) {
    const result = score(id, JSON.parse(readFileSync(file, 'utf8')));
    if (result.actionAndCandidates === 'fail') process.exitCode = 1;
    return result;
  }
  throw new Error('Usage: experiment.mjs packet|control <case> or experiment.mjs score <case> <response.json>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(main(process.argv.slice(2)), null, 2));
}
