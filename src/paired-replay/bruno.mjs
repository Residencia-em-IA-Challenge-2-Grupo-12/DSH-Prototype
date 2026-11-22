const student = 'bruno';
const courses = [
  { name: 'Algoritmos', date: '2026-12-14', time: '09:00', citation: {
    path: 'notices/aviso-turma-n02.md',
    quote: 'A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.',
  } },
  { name: 'Banco de Dados', date: '2026-12-14', time: '18:00', citation: {
    path: 'courses/banco-de-dados.md',
    quote: 'Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo',
  } },
];

const studyWindows = [
  { weekday: 1, start: '19:00', end: '21:15' },
  { weekday: 3, start: '19:00', end: '21:15' },
  { weekday: 6, start: '14:00', end: '16:15' },
  { weekday: 0, start: '10:00', end: '12:15' },
];
const record = { courses, studyWindows, through: '2026-11-15', targetHours: 5, maxDailyStudyHours: 2,
  studyBreakMinutes: 15, assumption: 'Disponibilidade provisória para duas semanas, sujeita ao calendário.' };
const questionText = 'Quantas horas por semana funcionam para você e quais janelas podemos considerar nestas duas semanas?';
export const draftRequest = 'Gere a proposta revisável para as duas semanas usando os dados confirmados.';
export const scriptedTools = ['list_synthetic_files', 'read_synthetic_file', 'list_calendar', 'propose_planning_context', 'draft_study_plan'];

// Authored session driver for the known case. The question and proposed inputs
// exercise the real managed API, planner and citation checks without a model.
export function createBrunoSession(service) {
  const messages = [];
  let question = null;
  let phase = 'initial';
  const view = () => ({ messages, question, busy: false, error: null });
  const call = (method, args = {}) => service.agent.call(method, { student, ...args });
  function addUserMessage(text) {
    messages.push({ type: 'user', text });
  }
  return {
    snapshot: async () => view(),
    async prompt(text) {
      if (question) throw new Error('Answer the current question first');
      addUserMessage(text);
      if (phase === 'initial') {
        for (const directory of ['courses', 'notices']) {
          await call('list_synthetic_files', { path: directory });
        }
        for (const path of ['courses/algoritmos.md', ...courses.map(course => course.citation.path)]) {
          await call('read_synthetic_file', { path });
        }
        await call('list_calendar');
        question = { requestId: 'availability', questions: [{ id: 'availability', question: questionText, options: [] }] };
        phase = 'awaiting_answer';
      } else if (text === draftRequest && ['initial_review', 'revised_review'].includes(phase)) {
        await call('draft_study_plan', { weeks: 2 });
        phase = phase === 'initial_review' ? 'initial_proposal' : 'revised_proposal';
      } else if (phase === 'initial_proposal' && text.includes('segundas-feiras')) {
        await call('propose_planning_context', { record: { ...record, studyWindows: studyWindows.filter(window => window.weekday !== 1) } });
        phase = 'revised_review';
      } else {
        throw new Error('Unsupported step in the authored Bruno session');
      }
      return view();
    },
    async answer(requestId, answers) {
      const reply = answers[0];
      if (phase !== 'awaiting_answer' || requestId !== question?.requestId || answers.length !== 1 ||
          reply.id !== 'availability' || !reply.custom?.includes('5 horas por semana')) {
        throw new Error('The authored Bruno question requires the prepared weekly availability answer');
      }
      addUserMessage(reply.custom);
      question = null;
      await call('propose_planning_context', { record });
      phase = 'initial_review';
      return view();
    },
  };
}
