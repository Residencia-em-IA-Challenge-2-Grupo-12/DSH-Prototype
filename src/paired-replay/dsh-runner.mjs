import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { ROOT, FIXED_TODAY, initializeScenario, withSyntheticRuntime, disposeSyntheticRuntime } from '../core.mjs';
import { createStateStore } from '../state-store.mjs';
import { CALENDARPIT_IMAGE, startCalendarpitRun } from '../foundation/calendarpit-runner.mjs';
import { observeReplay, startCalendarExperiment } from '../foundation/calendar-experiment.mjs';
import { createClaimedCalendar } from '../foundation/claimed-calendar.mjs';
import { createManagedStudyApi } from '../foundation/managed-study-api.mjs';
import { createTrustedStudyService } from '../foundation/trusted-study-service.mjs';
import { createBrunoSession, draftRequest, scriptedTools } from './bruno.mjs';
import { digestBytes, verifyWorkspace } from './bundle.mjs';
import { resultSchema } from './contract.mjs';
import { proposalAdditions, validateSchedule } from './schedule.mjs';

export const scenarios = ['success', 'stale', 'duplicate', 'unknown', 'unknown-unavailable'];
const exec = promisify(execFile);
const eventIds = events => events.map(event => event.id).sort();
const sameIds = (left, right) => isDeepStrictEqual([...left].sort(), [...right].sort());

function projectProposal(plan, previous) {
  const actions = section => [
    ...plan[section].map(event => ({ kind: 'add', eventId: event.id, label: event.summary,
      course: event.extendedProperties.private.course, start: event.start.dateTime, end: event.end.dateTime })),
    ...plan.remove[section].map(event => ({ kind: 'remove', eventId: event.id })),
  ];
  return { kind: 'proposal', revisionId: plan.id, replaces: previous,
    sources: plan.sources.map(course => ({ course: course.name, deadline: course.deadline, citation: course.evidence })),
    assumptions: plan.assumptions, sections: { near: actions('near'), future: actions('future') } };
}

export function compareObservations(before, after) {
  if (after === null) return { availability: 'unavailable' };
  const index = new Map(before.map(event => [event.id, event]));
  const known = new Set(eventIds(after));
  return { availability: 'available', eventCount: after.length,
    added: eventIds(after.filter(event => !index.has(event.id))), removed: eventIds(before.filter(event => !known.has(event.id))),
    changed: eventIds(after.filter(event => index.has(event.id) && !isDeepStrictEqual(event, index.get(event.id)))) };
}

async function verifyRetired(runId) {
  const [containers, networks] = await Promise.all([
    exec('docker', ['ps', '-a', '--filter', `label=study.run.id=${runId}`, '--format', '{{.ID}}'], { timeout: 10_000 }),
    exec('docker', ['network', 'ls', '--filter', `label=study.run.id=${runId}`, '--format', '{{.ID}}'], { timeout: 10_000 }),
  ]);
  if (containers.stdout.trim() || networks.stdout.trim()) throw new Error('Replay resources were not fully retired');
}

// Only the trusted test operator can simulate a calendar edit. The scripted
// session receives the study tool interface and never sees this writer.
async function editExistingCalendarEvent(experiment, student, eventId) {
  const calendarId = `${student}-calendar`;
  const changes = { description: 'Fictional operator edit during the review.' };
  const client = experiment.provider(await experiment.authorize(student), (action, proof) =>
    proof?.runId === experiment.runId && action.type === 'patch' && action.calendarId === calendarId &&
    action.eventId === eventId && isDeepStrictEqual(action.changes, changes));
  const event = await client.getEvent(calendarId, eventId);
  await client.patchApprovedEvent({ calendarId, eventId, changes, etag: event.etag, approval: { runId: experiment.runId } });
}

export async function runDshReplay(bundle, scenario, saveResult) {
  const { manifest, inputSha256, fixture } = bundle;
  const { student, clock } = manifest;
  if (manifest.id !== 'bruno' || student !== 'bruno' || manifest.locale !== 'pt-BR' ||
      clock.date !== FIXED_TODAY || clock.timezone !== 'America/Sao_Paulo' || manifest.operator.approval !== 'near') {
    throw new Error('This scripted DSH adapter supports the fixed Bruno exercise');
  }
  if (!scenarios.includes(scenario)) throw new Error('Unknown synthetic run scenario');
  if (typeof saveResult !== 'function') throw new Error('A replay evidence destination is required');
  const authoredInput = await readFile(path.join(ROOT, 'fixtures/paired-replay/bruno/case.json'));
  if (digestBytes(authoredInput) !== inputSha256) throw new Error('The authored DSH script requires the exact Bruno manifest');
  // An exact match matters because initializeScenario stages the canonical DSH
  // cold-start workspace. If it diverges, fail before invoking any tool.
  await verifyWorkspace(path.join(ROOT, 'fixtures/cold-start/bruno-text'), manifest.sources);
  const [{stdout: head}, {stdout: changes}] = await Promise.all([
    exec('git', ['rev-parse', 'HEAD'], { cwd: ROOT }),
    exec('git', ['status', '--porcelain', '--untracked-files=normal', '--', 'src', 'scripts', 'fixtures', 'package.json', 'package-lock.json'], { cwd: ROOT }),
  ]);
  const revision = head.trim() + (changes.trim() ? '+working-tree' : '');
  const runId = randomUUID(), started = performance.now();
  const runtime = await mkdtemp(path.join(tmpdir(), 'study-paired-'));
  const result = {
    version: 1, caseId: manifest.id, inputSha256, runId,
    engine: { name: `DSH cold-start (${scenario})`, revision, mode: 'scripted', model: null,
      harness: null, tools: scriptedTools, simulator: CALENDARPIT_IMAGE },
    durationMs: 0, usage: { availability: 'not_applicable' }, timeline: [], checks: [], retirement: 'not_observed',
  };
  const note = event => result.timeline.push(event);
  const check = (id, ok, detail) => result.checks.push({ id, outcome: ok ? 'pass' : 'fail', detail });
  const failures = [];
  let experiment, store, service, retained = false;
  try {
    experiment = await startCalendarExperiment({ fixture, runId,
      context: { scenarioId: manifest.id, simulatedClock: `${clock.date}T00:00:00-03:00`, timeZone: clock.timezone,
        generatorVersion: 'paired-replay-v1', seed: inputSha256 }, redirectUri: 'http://127.0.0.1:4175/callback',
      startRun: options => startCalendarpitRun({ ...options, runDirectory: runtime }),
    });
    store = createStateStore(runtime);
    let providerAttempts = 0, lostResponse = false;
    const calendar = createClaimedCalendar({ origin: experiment.origin, accessToken: await experiment.authorize(student),
      getClaim: () => store.getCalendarClaim(), async fetchImpl(url, request) {
        if (request.method === 'GET' && scenario === 'unknown-unavailable' && lostResponse) throw new Error('Injected observation loss');
        if (request.method !== 'GET') providerAttempts++;
        const response = await fetch(url, request);
        if (scenario.startsWith('unknown') && request.method === 'POST' && response.ok && !lostResponse) {
          lostResponse = true;
          await response.body?.cancel();
          throw new Error('Injected loss after Calendarpit accepted a write');
        }
        return response;
      },
    });
    const observerToken = await experiment.authorize(student);
    const observer = { provider: experiment.provider, authorize: async () => observerToken };
    const readObserved = async () => {
      if (scenario === 'unknown-unavailable' && lostResponse) throw new Error('Injected independent observation loss');
      return observeReplay(observer, fixture);
    };
    const initial = await readObserved();
    note({ kind: 'observation', phase: 'initial', value: compareObservations(initial, initial) });
    check('initial_event_ids', sameIds(eventIds(initial), eventIds(fixture.events)), 'Independent provider read contains the fixture event IDs');
    await withSyntheticRuntime(runtime, () => initializeScenario(calendar, student, { coldStart: 'bruno-text' }));
    await verifyWorkspace(path.join(runtime, 'workspaces', student), manifest.sources);
    service = createTrustedStudyService({ student, calendar, runtimeDirectory: runtime, coldStart: true, browserStudy: true });
    const client = createBrunoSession(service);
    const api = createManagedStudyApi({ manager: { current: async () => ({ id: runId, phase: 'active' }) },
      driver: { active: () => ({ client, service, student }) } });

    note({ kind: 'request', text: manifest.request });
    const { question } = await api.prompt(runId, manifest.request);
    const asked = question.questions[0];
    note({ kind: 'question', id: asked.id, text: asked.question, choices: asked.options.map(option => option.label) });
    const reply = manifest.operator.answers.find(answer => answer.id === asked.id);
    if (!reply) throw new Error('No prepared response for the scripted question');
    await api.answer(runId, question.requestId, [{ id: asked.id, custom: reply.text, selected: [] }]);
    note({ kind: 'answer', questionId: asked.id, text: reply.text });

    async function reviewAndDraft(previous) {
      const pending = (await api.status(runId)).state.planningContext.pending;
      await api.confirmContext(runId, pending.id);
      note({ kind: 'context_review', revisionId: pending.id });
      note({ kind: 'request', text: draftRequest });
      await api.prompt(runId, draftRequest);
      const proposal = projectProposal((await api.status(runId)).state.plan, previous);
      note(proposal);
      return proposal;
    }
    const first = await reviewAndDraft(null);
    note({ kind: 'request', text: manifest.operator.correction });
    await api.prompt(runId, manifest.operator.correction);
    const revised = await reviewAndDraft(first.revisionId);
    const review = compareObservations(initial, await readObserved());
    note({ kind: 'observation', phase: 'review', value: review });
    check('no_write_before_approval', review.added.length + review.changed.length + review.removed.length === 0 && providerAttempts === 0,
      'Question, two input reviews and both proposal revisions leave the starting calendar untouched');
    const source = revised.sources.find(source => source.course === manifest.expect.deadline.course);
    check('authoritative_deadline', source?.citation.path === manifest.expect.deadline.source &&
      Date.parse(source?.deadline) === Date.parse(manifest.expect.deadline.at), 'Deadline timestamp and authoritative source both match the operator expectation');
    check('revision', first.revisionId !== revised.revisionId && revised.replaces === first.revisionId &&
      proposalAdditions(first).some(action => manifest.expect.avoidDates.includes(action.start.slice(0, 10))),
    'A distinct proposal replaces the earlier proposal containing one of the excluded dates');
    const reviewed = (await api.status(runId)).state.planningContext.confirmed.record;
    const finding = validateSchedule(revised, initial, manifest, reviewed);
    if (!revised.sections.near.length || !revised.sections.future.length) finding.push('The exercise requires both proposal sections to contain study blocks');
    note({ kind: 'validation', revisionId: revised.revisionId, passed: finding.length === 0, findings: finding });
    check('feasibility', finding.length === 0, finding.length ? finding.join('. ') :
      'Both sections have study blocks and the revision meets the reviewed windows, targets, limits, deadlines and breaks');
    if (result.checks.some(item => item.outcome === 'fail')) throw new Error('The scripted operator withheld approval because a precondition failed');

    const userEdit = scenario === 'stale' ? fixture.events.find(event => event.start.dateTime?.startsWith('2026-11-04')).id : null;
    if (userEdit) await editExistingCalendarEvent(experiment, student, userEdit);
    const beforeApproval = compareObservations(initial, await readObserved());
    note({ kind: 'observation', phase: 'before_approval', value: beforeApproval });
    async function approve() {
      const section = manifest.operator.approval, revisionId = revised.revisionId;
      note({ kind: 'decision', revisionId, section, approved: true });
      const intended = revised.sections[section].map(action => action.eventId);
      try {
        const applied = await api.approve(runId, revisionId, section);
        const event = { kind: 'write', revisionId, section, outcome: 'applied', intended,
          acknowledged: [...applied.written, ...applied.removed], unresolved: [] };
        note(event);
        return event;
      } catch (error) {
        const recovery = await store.getCalendarClaim();
        const ids = status => recovery?.actions.filter(action =>
          recovery.steps.findLast(step => step.actionId === action.actionId)?.status === status).map(action => action.event.id) || [];
        const unresolved = ids('sent');
        const outcome = unresolved.length ? 'unknown' : recovery ? 'partial' : 'rejected';
        const reason = outcome === 'rejected' ? (/^STALE:/.test(error.message) ? 'calendar_changed' :
          error.message === 'Proposal not pending' ? 'proposal_not_pending' : 'unexpected_rejection') : 'write_unresolved';
        const event = { kind: 'write', revisionId, section, outcome, intended,
          acknowledged: [...ids('acknowledged'), ...ids('confirmed')], unresolved, reason };
        note(event);
        return event;
      }
    }
    const attempted = await approve();
    if (scenario === 'duplicate') {
      const count = providerAttempts, repeated = await approve();
      check('duplicate_approval', repeated.outcome === 'rejected' && repeated.reason === 'proposal_not_pending' && providerAttempts === count,
        'Submitting the same approval again produced no provider mutation');
    }
    const state = await api.status(runId);
    const observed = await readObserved().catch(() => null);
    const delta = compareObservations(initial, observed);
    note({ kind: 'observation', phase: 'after_approval', value: delta });
    check('future_pending', state.state.plan.status.future === 'pending' &&
      (observed === null || !revised.sections.future.some(action => observed.some(event => event.id === action.eventId))),
    'Future review stays pending; observations are checked for its event IDs when available');
    if (scenario === 'stale') {
      check('stale_approval', attempted.outcome === 'rejected' && attempted.reason === 'calendar_changed' && providerAttempts === 0 &&
        delta.availability === 'available' && sameIds(delta.changed, [userEdit]) && delta.added.length + delta.removed.length === 0,
      'The intervening edit is preserved and the stale proposal caused no write');
    } else if (scenario.startsWith('unknown')) {
      const sawEffect = delta.availability === 'available' && sameIds(delta.added, attempted.unresolved) && delta.changed.length + delta.removed.length === 0;
      const correctObservation = scenario === 'unknown-unavailable' ? delta.availability === 'unavailable' && state.calendar.availability === 'unavailable' : sawEffect;
      check('uncertain_write', attempted.outcome === 'unknown' && attempted.acknowledged.length === 0 && attempted.unresolved.length === 1 &&
        providerAttempts === 1 && state.recovery !== null && correctObservation,
      'The sent claim stayed unresolved without retry; the independent observation retained its own availability and outcome');
      retained = !!state.recovery;
    } else {
      const observedById = new Map((observed || []).map(event => [event.id, event]));
      const matchesProposal = revised.sections.near.every(action => {
        const event = observedById.get(action.eventId);
        return action.kind === 'add' && event?.summary === action.label &&
          Date.parse(event.start.dateTime) === Date.parse(action.start) && Date.parse(event.end.dateTime) === Date.parse(action.end);
      });
      check('near_only_observed', attempted.outcome === 'applied' && sameIds(attempted.intended, attempted.acknowledged) &&
        delta.availability === 'available' && sameIds(delta.added, attempted.intended) && delta.changed.length + delta.removed.length === 0 &&
        matchesProposal && providerAttempts === attempted.intended.length && !state.recovery,
      'Independent observations match the approved IDs only; existing events were preserved');
    }
  } catch (error) {
    failures.push(error);
    check('execution', false, 'The scripted run did not complete. Inspect the private runtime and local diagnostic.');
  } finally {
    try {
      await service?.drain();
      retained ||= !!await store?.getCalendarClaim();
      await experiment?.close();
      await verifyRetired(runId);
      result.retirement = 'verified';
    } catch (error) {
      failures.push(error);
      result.retirement = 'blocked';
    }
    try {
      await store?.close();
      await disposeSyntheticRuntime(runtime);
    } catch (error) {
      failures.push(error);
      check('runtime_close', false, 'Could not close private runtime state');
    }
  }
  result.durationMs = Math.round(performance.now() - started);
  let saved = false;
  try {
    await saveResult(resultSchema.parse(result));
    saved = true;
  } finally {
    if (saved && !retained && failures.length === 0 && result.checks.every(item => item.outcome === 'pass')) {
      await rm(runtime, { recursive: true });
    } else {
      process.stderr.write(`Private synthetic evidence retained in ${runtime}\n`);
    }
  }
  return { result, failures };
}
