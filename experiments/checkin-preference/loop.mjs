import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest } from '../../src/core.mjs';
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

export function createCheckinLoop({ calendar, interpret, language = 'en', storage }) {
  const copy = checkinCopy[language];
  const outline = candidate => copy.outline(candidate.studyMinutes / 60, candidate.protectedMinutes / 60);
  let data = { week: 0, plan: null, calendarBase: null, pendingId: null, confirmedId: null, previousId: null,
    awaitingChoice: false, notes: [], revisions: [], selections: [], approvalAttempts: 0 };
  let question = null, options = [], busy = false;
  const preview = createAvailabilityPreview(calendar, 'ana');
  const messages = [];
  const append = (type, text) => messages.push({ id: randomUUID(), type, text });
  const snapshot = async () => ({ messages, question, busy, error: null });
  const revision = (state, id) => state.revisions.find(item => item.id === id);
  const confirmedIn = state => revision(state, state.confirmedId);
  const exclusive = async fn => {
    if (busy) throw Error(copy.busy);
    busy = true;
    try { return await fn(); } finally { busy = false; }
  };
  async function commit(next) {
    if (storage) await storage.save(next);
    data = next;
  }

  function describe(preference) {
    const fallback = preference.fallbackMinutes == null ? copy.noFallback : copy.fallback(preference.fallbackMinutes);
    return copy.friday + ' · ' + copy.strength[preference.kind] + ' ' + fallback + ' ' + copy.startDate(preference.validFrom);
  }
  function project(item) {
    if (!item) return null;
    const { id, preference, sourceIds, confirmedAt, supersedesId } = item;
    return {
      id, confirmedAt, supersedesId, sourceIds,
      expired: !!confirmedAt && dateInWeek(data.week) > preference.validThrough,
      record: {
        courses: sourceCourses, studyWindows: [
          { weekday: 3, start: '14:00', end: '16:15' },
          { weekday: 5, start: '14:00', end: '16:15' },
          { weekday: 0, start: '14:00', end: '15:00' },
        ], targetHours: 4, maxDailyStudyHours: 2, studyBreakMinutes: 15,
        through: preference.validThrough, assumption: describe(preference),
      },
      operatorReplies: data.notes.filter(note => sourceIds.includes(note.id)).map(note => note.text),
    };
  }

  function select(next, candidate, reason) {
    const date = dateInWeek(next.week);
    const active = confirmedIn(next);
    const applied = active && date >= active.preference.validFrom && date <= active.preference.validThrough ? active.id : null;
    next.plan = { ...candidate.proposal, preferenceRevisionId: applied };
    next.awaitingChoice = false;
    next.selections.push({
      weekOf: date, reason, planningRevisionId: applied,
      proposalId: next.plan.id, studyMinutes: candidate.studyMinutes, fridayMinutes: candidate.protectedMinutes,
      windows: candidate.windows,
    });
  }

  function propose(events, next) {
    const candidates = generateCandidates(events, { week: next.week, includeProposal: true });
    const decision = decideRoutinePreference(candidates, confirmedIn(next)?.preference, dateInWeek(next.week));
    if (decision.action === 'recommend') return { decision, selected: candidates.find(candidate => candidate.id === decision.candidateIds[0]) };
    const choices = decision.candidateIds.map(id => candidates.find(candidate => candidate.id === id))
      .map(candidate => ({ ...candidate, label: candidate.protectedMinutes === 0
        ? copy.keep : copy.useFriday(candidate.protectedMinutes) }));
    return { decision, choices };
  }
  function stage(choices) {
    return preview.stage(choices.map(({ label, windows }) => ({ label, windows })));
  }
  function showChoice(choices) {
    options = choices;
    question = { requestId: randomUUID(), questions: [{
      id: questionId, question: copy.question,
      options: choices.map(candidate => ({ label: candidate.label, description: outline(candidate) })),
    }] };
  }
  function showSelection(candidate) {
    append('study-review', copy.preview(dateInWeek(data.week)) + ' ' + outline(candidate));
  }
  async function preparePreview(next) {
    const events = await calendar.events();
    next.calendarBase = digest(events);
    const result = propose(events, next);
    if (result.selected) select(next, result.selected, result.decision.reason);
    else {
      next.plan = null;
      next.awaitingChoice = true;
      await stage(result.choices);
    }
    try { await commit(next); }
    catch (error) {
      if (result.choices) preview.clear();
      throw error;
    }
    return result;
  }
  function present(result) {
    if (result.selected) showSelection(result.selected);
    else showChoice(result.choices);
  }

  const client = {
    snapshot,
    async prompt(text) {
      await exclusive(async () => {
        if (question) throw Error(copy.finishChoice);
        if (data.pendingId && text === copy.advance) throw Error(copy.finishReview);
        const next = structuredClone(data);
        if (text === copy.advance) {
          if (next.week !== 0) throw Error(copy.lastWeek);
          next.week = 1;
          const result = await preparePreview(next);
          append('user', text);
          const confirmed = confirmedIn(data);
          append('study-review', confirmed ? copy.expiry(confirmed.preference.validThrough) : copy.noPreference);
          present(result);
          return;
        }
        if (next.week !== 0) throw Error(copy.noNewNotes);
        if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw Error(copy.shortNote);
        const note = { id: randomUUID(), planningWeek: dateInWeek(next.week), text: text.trim() };
        const pending = revision(next, next.pendingId);
        const prior = pending || confirmedIn(next);
        const extracted = preferenceSchema.parse(await interpret({
          weekOf: dateInWeek(next.week), weekThrough: dateInWeek(next.week, 6),
          latest: note.text, previous: prior?.preference || null,
        }));
        if (extracted.validThrough < dateInWeek(next.week) || extracted.validThrough > dateInWeek(next.week, 6) ||
            extracted.kind !== 'soft' && extracted.fallbackMinutes !== null) {
          throw Error(copy.invalidScope);
        }
        const preference = { ...extracted, validFrom: dateInWeek(next.week) };
        if (pending) pending.status = 'superseded';
        next.previousId = prior?.id ?? null;
        next.pendingId = randomUUID();
        next.notes.push(note);
        next.revisions.push({
          id: next.pendingId, preference, sourceIds: next.notes.map(item => item.id), status: 'pending',
          confirmedAt: null, supersedesId: next.confirmedId,
        });
        await commit(next);
        append('user', note.text);
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
        const next = structuredClone(data);
        select(next, selected, 'user_selected_review');
        await commit(next);
        question = null;
        append('user', selected.label);
        showSelection(selected);
      });
      return snapshot();
    },
    async cancelQuestion(requestId) {
      await exclusive(async () => {
        if (question?.requestId !== requestId) throw Error(copy.staleQuestion);
        await commit({ ...data, awaitingChoice: false });
        question = null;
        append('study-review', copy.dismissed);
      });
      return snapshot();
    },
  };

  return {
    get evidence() {
      return { notes: data.notes, revisions: data.revisions, selections: data.selections, approvalAttempts: data.approvalAttempts };
    },
    client,
    service: {
      availabilityPreview: preview,
      async status() {
        const events = await calendar.events();
        return {
          events, calendar: { availability: 'available' },
          state: { plan: data.plan, planningContext: {
            pending: project(revision(data, data.pendingId)), confirmed: project(confirmedIn(data)), previous: project(revision(data, data.previousId)),
          } },
          availabilityOptions: preview.observe(events),
        };
      },
      async confirmPlanningContext(id) {
        return exclusive(async () => {
          const next = structuredClone(data);
          const pending = revision(next, next.pendingId);
          if (!pending || pending.id !== id) throw Error(copy.staleRevision);
          if (pending.preference.kind === 'unknown') throw Error(copy.clarify);
          const confirmed = confirmedIn(next);
          if (confirmed) confirmed.status = 'superseded';
          pending.status = 'confirmed';
          pending.confirmedAt = new Date().toISOString();
          next.confirmedId = id;
          next.pendingId = null;
          const result = await preparePreview(next);
          present(result);
          return project(confirmedIn(data));
        });
      },
      async approvePlan() {
        data.approvalAttempts++;
        throw Error(copy.previewOnly);
      },
    },
    async start() {
      const saved = await storage?.load();
      if (!saved) {
        present(await preparePreview(structuredClone(data)));
        append('study-review', copy.invite);
        return;
      }
      const events = await calendar.events();
      if (saved.calendarBase !== digest(events)) throw Error(copy.calendarChanged);
      data = saved;
      if (data.awaitingChoice) {
        const result = propose(events, data);
        if (!result.choices) throw Error(copy.calendarChanged);
        await stage(result.choices);
        showChoice(result.choices);
      }
      append('study-review', copy.resumed);
    },
  };
}
