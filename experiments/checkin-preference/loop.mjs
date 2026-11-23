import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createAvailabilityPreview } from '../../src/foundation/availability-preview.mjs';
import { decideRoutinePreference } from '../routine-preference/decision.mjs';
import { dateInWeek, generateCandidates } from '../routine-preference/widget-cases.mjs';

import { checkinCopy } from './copy.mjs';
const questionId = 'reviewed-friday-tradeoff';
const preferenceSchema = z.strictObject({
  kind: z.enum(['unknown', 'soft', 'hard']),
  validThrough: z.iso.date(),
  fallbackMinutes: z.union([z.null(), z.literal(0), z.literal(60)]),
});
const sourceCourses = [
  { name: 'Machine Learning', date: '2026-11-30', time: '18:00', citation: { path: 'courses/module-guide.md', quote: '| 30 November | **Final submission closes** | **2026-11-30 18:00** | Classification project |' } },
  { name: 'Statistics', date: '2026-12-14', time: '09:00', citation: { path: 'courses/applied-statistics.md', quote: 'The probability and inference exam starts on 2026-12-14 at 09:00, São Paulo time.' } },
];

export function createCheckinLoop({ calendar, interpret, language = 'en' }) {
  const copy = checkinCopy[language];
  const outline = candidate => copy.outline(candidate.studyMinutes / 60, candidate.protectedMinutes / 60);
  let week = 0, plan = null, pending = null, confirmed = null, previous = null;
  let question = null, options = [], busy = false;
  const preview = createAvailabilityPreview(calendar, 'ana');
  const messages = [];
  const evidence = { notes: [], revisions: [], selections: [], approvalAttempts: 0 };
  const append = (type, text) => messages.push({ id: randomUUID(), type, text });
  const snapshot = async () => ({ messages, question, busy, error: null });
  const exclusive = async fn => {
    if (busy) throw Error(copy.busy);
    busy = true;
    try { return await fn(); } finally { busy = false; }
  };

  function describe(preference) {
    const fallback = preference.fallbackMinutes == null ? copy.noFallback : copy.fallback(preference.fallbackMinutes);
    return copy.friday + ' · ' + copy.strength[preference.kind] + ' ' + fallback + ' ' + copy.startDate(preference.validFrom);
  }
  function project(revision) {
    if (!revision) return null;
    const { id, preference, sourceIds } = revision;
    return {
      id, record: {
        courses: sourceCourses, studyWindows: [
          { weekday: 3, start: '14:00', end: '16:15' },
          { weekday: 5, start: '14:00', end: '16:15' },
          { weekday: 0, start: '14:00', end: '15:00' },
        ], targetHours: 4, maxDailyStudyHours: 2, studyBreakMinutes: 15,
        through: preference.validThrough, assumption: describe(preference),
      },
      operatorReplies: evidence.notes.filter(item => sourceIds.includes(item.id)).map(item => item.text),
    };
  }

  function select(candidate, reason) {
    const applied = confirmed && dateInWeek(week) <= confirmed.preference.validThrough ? confirmed : null;
    plan = candidate.proposal;
    evidence.selections.push({
      weekOf: dateInWeek(week), reason, planningRevisionId: applied?.id || null,
      proposalId: plan.id, studyMinutes: candidate.studyMinutes, fridayMinutes: candidate.protectedMinutes,
      windows: candidate.windows,
    });
    append('study-review', copy.preview(dateInWeek(week)) + ' ' + outline(candidate));
  }

  async function propose(preference) {
    const candidates = generateCandidates(await calendar.events(), { week, includeProposal: true });
    const decision = decideRoutinePreference(candidates, preference, dateInWeek(week));
    if (decision.action === 'recommend') return { decision, selected: candidates.find(candidate => candidate.id === decision.candidateIds[0]) };
    const choices = decision.candidateIds.map(id => candidates.find(candidate => candidate.id === id))
      .map(candidate => ({ ...candidate, label: candidate.protectedMinutes === 0
        ? copy.keep : copy.useFriday(candidate.protectedMinutes) }));
    await preview.stage(choices.map(({ label, windows }) => ({ label, windows })));
    return { decision, choices };
  }
  function present(result) {
    if (result.selected) return select(result.selected, result.decision.reason);
    options = result.choices;
    plan = null;
    question = { requestId: randomUUID(), questions: [{
      id: questionId, question: copy.question,
      options: options.map(candidate => ({ label: candidate.label, description: outline(candidate) })),
    }] };
  }

  const client = {
    snapshot,
    async prompt(text) {
      await exclusive(async () => {
        if (question) throw Error(copy.finishChoice);
        if (pending && text === copy.advance) throw Error(copy.finishReview);
        if (text === copy.advance) {
          if (week !== 0) throw Error(copy.lastWeek);
          week = 1;
          let result;
          try { result = await propose(confirmed?.preference); }
          catch (error) { week = 0; throw error; }
          append('user', text);
          append('study-review', confirmed ? copy.expiry(confirmed.preference.validThrough) : copy.noPreference);
          present(result);
          return;
        }
        if (week !== 0) throw Error(copy.noNewNotes);
        if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw Error(copy.shortNote);
        const note = { id: randomUUID(), planningWeek: dateInWeek(week), text: text.trim() };
        evidence.notes.push(note);
        append('user', note.text);
        const prior = pending || confirmed;
        const extracted = preferenceSchema.parse(await interpret({
          weekOf: dateInWeek(week), weekThrough: dateInWeek(week, 6),
          latest: note.text, previous: prior?.preference || null,
        }));
        if (extracted.validThrough < dateInWeek(week) || extracted.validThrough > dateInWeek(week, 6) ||
            extracted.kind !== 'soft' && extracted.fallbackMinutes !== null) {
          throw Error(copy.invalidScope);
        }
        const preference = { ...extracted, validFrom: dateInWeek(week) };
        if (pending) pending.status = 'superseded';
        previous = prior;
        pending = { id: randomUUID(), preference, sourceIds: evidence.notes.map(item => item.id), status: 'pending' };
        evidence.revisions.push(pending);
        append('study-review', copy.review + ' ' + describe(preference));
      });
      return snapshot();
    },
    async answer(requestId, answers) {
      await exclusive(async () => {
        if (question?.requestId !== requestId || !Array.isArray(answers) || answers.length !== 1 ||
            answers[0]?.id !== questionId || !Array.isArray(answers[0].selected)) throw Error(copy.staleQuestion);
        const [answer] = answers;
        const selected = options.find(candidate => candidate.label === answer.selected[0]);
        if (!selected || answer.custom || answer.selected.length !== 1) throw Error(copy.offeredChoice);
        question = null;
        append('user', selected.label);
        select(selected, 'user_selected_review');
      });
      return snapshot();
    },
    async cancelQuestion(requestId) {
      if (busy || question?.requestId !== requestId) throw Error(copy.staleQuestion);
      question = null;
      append('study-review', copy.dismissed);
      return snapshot();
    },
  };

  return {
    evidence, client,
    service: {
      availabilityPreview: preview,
      async status() {
        const events = await calendar.events();
        return {
          events, calendar: { availability: 'available' },
          state: { plan, planningContext: { pending: project(pending), confirmed: project(confirmed), previous: project(previous) } },
          availabilityOptions: preview.observe(events),
        };
      },
      async confirmPlanningContext(id) {
        return exclusive(async () => {
          if (!pending || pending.id !== id) throw Error(copy.staleRevision);
          if (pending.preference.kind === 'unknown') throw Error(copy.clarify);
          const result = await propose(pending.preference);
          if (confirmed) confirmed.status = 'superseded';
          confirmed = pending;
          confirmed.status = 'confirmed';
          pending = null;
          present(result);
          return project(confirmed);
        });
      },
      async approvePlan() {
        evidence.approvalAttempts++;
        throw Error(copy.previewOnly);
      },
    },
    async start() {
      const result = await propose(null);
      present(result);
      append('study-review', copy.invite);
    },
  };
}
