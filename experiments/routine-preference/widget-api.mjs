import { randomUUID } from 'node:crypto';
import { createAvailabilityPreview } from '../../src/foundation/availability-preview.mjs';
import { createManagedStudyApi } from '../../src/foundation/managed-study-api.mjs';
import { decideRoutinePreference } from './decision.mjs';
import { clock, generateCandidates, reviewedCase } from './widget-cases.mjs';

const student = 'ana';
const questionId = 'schedule-fit';
const explain = candidate => candidate.studyMinutes / 60 + ' h total, ' + candidate.protectedMinutes / 60 + ' h on Friday.';

export function createWidgetExperiment(id, calendar) {
  const { statement, preference } = reviewedCase(id);
  const preview = createAvailabilityPreview(calendar, student);
  let run = null, question = null, options = [], messages = [];
  const evidence = { caseId: id, reviewedPreference: preference, decisions: [], answers: [], approvals: 0 };
  const append = (type, text) => messages.push({ id: randomUUID(), type, text });
  const snapshot = async () => ({ messages, question, busy: false, error: null });
  const client = {
    snapshot,
    async prompt() {
      if (messages.length) throw Error('Start a fresh exercise to review another preference');
      const candidates = generateCandidates(await calendar.events());
      const decision = decideRoutinePreference(candidates, preference, clock.date);
      options = decision.candidateIds.map(id => candidates.find(candidate => candidate.id === id));
      evidence.decisions.push({ ...decision, candidates: options });
      append('user', statement);
      if (decision.action === 'ask') {
        options = options.map(candidate => ({ ...candidate, label: candidate.protectedMinutes === 0
          ? 'Keep Friday free' : 'Use ' + candidate.protectedMinutes + ' minutes on Friday' }));
        await preview.stage(options.map(({ label, windows }) => ({ label, windows })));
        question = { requestId: randomUUID(), questions: [{
          id: questionId, question: 'Would you keep Friday free or use one Friday hour to reach four hours?',
          options: options.map(candidate => ({ label: candidate.label, description: explain(candidate) })),
        }] };
      } else {
        const lead = decision.reason === 'no_current_preference'
          ? 'The prior Friday preference expired.'
          : 'Your reviewed fallback permits one Friday hour.';
        append('assistant', lead + ' ' + options[0].label + '. ' + explain(options[0]));
      }
      return snapshot();
    },
    async answer(requestId, answers) {
      if (question?.requestId !== requestId || !Array.isArray(answers) || answers.length !== 1) {
        throw Error('Question is no longer pending');
      }
      const [answer] = answers;
      if (!Array.isArray(answer?.selected) || answer.id !== questionId) throw Error('Invalid question answer');
      const option = options.find(item => item.label === answer.selected[0]);
      const custom = typeof answer.custom === 'string' ? answer.custom.trim() : '';
      const isChoice = option && answer.selected.length === 1 && !custom;
      const isCustom = answer.selected.length === 0 && custom && custom.length <= 2000;
      if (!(isChoice || isCustom)) throw Error('Choose a shown option or enter another answer');
      evidence.answers.push(isChoice ? { candidateId: option.id } : { changeRequested: true });
      append('user', isChoice ? option.label : custom);
      append('assistant', isChoice ? 'Selected for review. ' + explain(option) : 'Review the requested change before drafting.');
      question = null;
      return snapshot();
    },
    async cancelQuestion(requestId) {
      if (question?.requestId !== requestId) throw Error('Question is no longer pending');
      question = null;
      evidence.answers.push({ dismissed: true });
      return snapshot();
    },
  };
  const service = {
    availabilityPreview: preview,
    async status() {
      const events = await calendar.events();
      return { events, calendar: { availability: 'available' }, state: { plan: null }, availabilityOptions: preview.observe(events) };
    },
    async approvePlan() {
      evidence.approvals++;
      throw Error('Calendar approval is outside this experiment');
    },
  };
  const operations = createManagedStudyApi({
    manager: {
      async current() { return run; },
      async start(selected) {
        if (run || selected !== student) throw Error('This exercise uses a single synthetic Ana run');
        question = null;
        options = [];
        messages = [];
        run = { id: randomUUID(), student, phase: 'active' };
        return run;
      },
      async retire({ expectedRunId }) {
        if (run?.id !== expectedRunId) throw Error('Selected run changed');
        preview.clear();
        run = null;
      },
    },
    driver: { active: () => ({ client, service }) },
  });
  return {
    evidence,
    api: {
      ...operations,
      async runStatus() { return { ...await operations.runStatus(), runtime: 'routine-preference-test', student, caseId: id }; },
    },
  };
}
