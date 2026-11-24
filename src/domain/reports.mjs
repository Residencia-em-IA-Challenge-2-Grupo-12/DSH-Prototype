import { promises as fs } from 'node:fs';
import path from 'node:path';
import { calendarBoundaryMs as millis } from '../calendar-time.mjs';
import {
  DEFAULT_TIMEZONE_OFFSET,
  FIXED_TODAY,
  addDaysIso,
  assertStudent,
  loadState,
  runtimeDir,
  stateStore,
  validateClock,
  writeJSON,
} from './runtime.mjs';

export function validateFeedback(input) {
  if (typeof input.eventId !== 'string' || !input.eventId.trim()) throw new Error('eventId required');
  if (input.completion && !['completed', 'partial', 'not_done', 'unknown'].includes(input.completion)) {
    throw new Error('Invalid completion');
  }
  for (const key of ['actualMinutes', 'effort']) {
    if (input[key] !== undefined && input[key] !== null && (!Number.isFinite(Number(input[key])) || Number(input[key]) < 0)) {
      throw new Error(`Invalid ${key}`);
    }
  }
  if (input.actualMinutes !== undefined && input.actualMinutes !== null && Number(input.actualMinutes) > 1440) {
    throw new Error('Actual minutes must be at most 1440');
  }
  if (input.effort !== undefined && input.effort !== null && Number(input.effort) > 5) {
    throw new Error('Effort must be between 0 and 5');
  }
  const recordedAt = input.recordedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(recordedAt))) throw new Error('Invalid recordedAt');
  return {
    eventId: input.eventId.trim(),
    completion: input.completion || 'unknown',
    actualMinutes: input.actualMinutes == null ? null : Number(input.actualMinutes),
    effort: input.effort == null ? null : Number(input.effort),
    note: String(input.note || '').slice(0, 2000),
    recordedAt,
  };
}

export async function addFeedback(student, input) {
  const record = validateFeedback(input);
  return stateStore.update(assertStudent(student), state => {
    state.feedback.push(record);
    return record;
  });
}

export function summarize(events, feedback, state, { today = FIXED_TODAY, timezoneOffset = DEFAULT_TIMEZONE_OFFSET } = {}) {
  validateClock(today, timezoneOffset);
  function category(event) {
    const title = (event.summary || '').toLowerCase();
    return (
      state.annotations?.[event.id]?.category ||
      (/study|estudo/.test(title)
        ? 'study'
        : /class|aula/.test(title)
          ? 'classes'
          : /work|trabalho/.test(title)
            ? 'work'
            : /sleep|rest|sono|descanso/.test(title)
              ? 'rest'
              : /physical|exercise|exercício/.test(title)
                ? 'physical'
                : 'other')
    );
  }

  function period(start, end) {
    const from = Date.parse(start);
    const to = Date.parse(end);
    const categories = { study: 0, classes: 0, work: 0, rest: 0, physical: 0, other: 0, unknown: 0 };
    const included = events.filter(event => event.status !== 'cancelled' && millis(event, 'start') < to && millis(event, 'end') > from);
    for (const event of included) {
      const ms = Math.min(millis(event, 'end'), to) - Math.max(millis(event, 'start'), from);
      if (Number.isFinite(ms) && ms > 0) categories[category(event)] += ms / 3_600_000;
    }
    for (const key of Object.keys(categories)) categories[key] = Math.round(categories[key] * 100) / 100;
    const ids = new Set(included.map(event => event.id));
    const related = feedback.filter(item => ids.has(item.eventId));
    return {
      start,
      end,
      categories,
      scheduledHours: Object.values(categories).reduce((a, b) => a + b, 0),
      feedbackCount: related.length,
      reportedMinutes: related.reduce((a, item) => a + (item.actualMinutes || 0), 0),
      eventsWithoutFeedback: included.filter(event => !feedback.some(item => item.eventId === event.id)).length,
    };
  }

  const recent = period(`${addDaysIso(today, -7)}T00:00:00${timezoneOffset}`, `${today}T00:00:00${timezoneOffset}`);
  const upcoming = period(`${today}T00:00:00${timezoneOffset}`, `${addDaysIso(today, 7)}T00:00:00${timezoneOffset}`);
  const categories = upcoming.categories;
  return {
    categories,
    scheduledHours: Object.values(categories).reduce((a, b) => a + b, 0),
    feedbackCount: feedback.length,
    reportedMinutes: feedback.reduce((a, item) => a + (item.actualMinutes || 0), 0),
    missingCompletion: feedback.filter(item => !item.completion || item.completion === 'unknown').length,
    periods: { recent, upcoming },
    unmatchedFeedback: feedback.filter(item => !events.some(event => event.id === item.eventId)).length,
    outlook: state.plan?.outlook || [],
    history: state.history,
    narrative: state.narrative || null,
    limitations: [
      'Scheduled time does not demonstrate completion.',
      'Categories are heuristic and may need correction.',
      'This is synthetic data, not a health assessment.',
    ],
  };
}

export async function report(calendar, student, clockOptions) {
  const state = await loadState(student);
  const events = await calendar.events(student);
  const metrics = summarize(events, state.feedback, state, clockOptions);
  const out = path.join(runtimeDir(), `${student}-report.json`);
  await writeJSON(out, metrics);
  const markdown =
    `# Synthetic routine report / Relatório sintético\n\n` +
    `Recent week / Semana anterior: ${metrics.periods.recent.scheduledHours}h scheduled; ${metrics.periods.recent.reportedMinutes} minutes reported.\n\n` +
    `Coming week / Próxima semana: ${metrics.periods.upcoming.scheduledHours}h scheduled.\n\n` +
    `Scheduled time is not proof of completion. / Tempo agendado não comprova realização.\n\n` +
    `## Categories / Categorias\n\n` +
    Object.entries(metrics.categories).map(([key, value]) => `- ${key}: ${value}h`).join('\n') +
    `\n\n## Agent interpretation / Interpretação do agente\n\n` +
    `${state.narrative || 'Not yet provided by an agent. / Ainda não fornecida por um agente.'}\n`;
  await fs.writeFile(path.join(runtimeDir(), `${student}-report.md`), markdown);
  return metrics;
}

export async function saveNarrative(student, narrative) {
  if (typeof narrative !== 'string' || narrative.length > 12_000) throw new Error('Invalid narrative');
  return stateStore.update(assertStudent(student), state => {
    state.narrative = narrative;
    return { saved: true };
  });
}
