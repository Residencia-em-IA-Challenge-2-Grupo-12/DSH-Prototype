import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  ROOT,
  applyApproved,
  draft,
  initializeScenario,
  loadState,
  makePlan,
  previewPlan,
  proposePlanningContext,
  confirmPlanningContext,
  runtimeDir,
  withSyntheticRuntime,
} from '../src/core.mjs';
import { createStudyBoundary } from '../src/foundation/study-boundary.mjs';
import { createTrustedStudyService } from '../src/foundation/trusted-study-service.mjs';
import { packBundle, readBundle } from '../src/paired-replay/bundle.mjs';
import { createHttpRunnerAdapter } from '../src/paired-replay/http-adapter.mjs';
import { matchPreparedAnswer, runPortableReplay } from '../src/paired-replay/runner.mjs';

const exec = promisify(execFile);

function canonicalSchedule(plan) {
  return [...plan.near, ...plan.future].map(block => ({
    section: block.status === 'confirmed' ? 'near' : 'future',
    course: block.extendedProperties.private.course,
    start: block.start.dateTime,
    end: block.end.dateTime,
  }));
}

function minutesByCourse(plan) {
  const totals = {};
  for (const block of [...plan.near, ...plan.future]) {
    const course = block.extendedProperties.private.course;
    totals[course] = (totals[course] || 0) + (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60_000;
  }
  return totals;
}

test('planner multi-course rotation is independent of weekday parity across Wed+Fri, Wed+Thu, and Tue+Thu', () => {
  const baseProfile = {
    student: 'parity-check',
    timezone: 'America/Sao_Paulo',
    targetHours: 4,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    availabilityThrough: '2026-11-08',
    courses: [
      { name: 'Machine Learning', deadline: '2026-11-30T12:00:00-03:00', source: 'synthetic:ml' },
      { name: 'Statistics', deadline: '2026-12-14T09:00:00-03:00', source: 'synthetic:stats' },
    ],
  };

  for (const [label, weekdays] of [
    ['Wed+Fri', [3, 5]],
    ['Wed+Thu', [3, 4]],
    ['Tue+Thu', [2, 4]],
  ]) {
    const profile = {
      ...baseProfile,
      studyWindows: weekdays.map(weekday => ({ weekday, start: '14:00', end: '16:15' })),
    };
    const plan = makePlan(profile, [], { weeks: 1, today: '2026-11-02' });
    assert.equal(plan.near.length, 4, label);
    assert.deepEqual(
      minutesByCourse(plan),
      { 'Machine Learning': 120, Statistics: 120 },
      `${label} must rotate cleanly independent of weekday parity`,
    );
  }
});

test('planner produces identical schedules when equal-deadline courses are reversed in JSON', async () => {
  const brunoCalendar = JSON.parse(await readFile(path.join(ROOT, 'fixtures/calendars/bruno.json'), 'utf8'));
  const coursesA = [
    { name: 'Banco de Dados', deadline: '2026-12-14T18:00:00-03:00', source: 'synthetic:bd' },
    { name: 'Algoritmos', deadline: '2026-12-14T18:00:00-03:00', source: 'synthetic:alg' },
  ];
  const coursesB = [...coursesA].reverse();
  const base = {
    student: 'bruno',
    timezone: 'America/Sao_Paulo',
    targetHours: 5,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    availabilityThrough: '2026-12-13',
    studyWindows: [
      { weekday: 3, start: '19:00', end: '21:15' },
      { weekday: 6, start: '14:00', end: '16:15' },
      { weekday: 0, start: '10:00', end: '12:15' },
    ],
  };

  const planA = makePlan({ ...base, courses: coursesA }, brunoCalendar.events, { weeks: 6, today: '2026-11-02' });
  const planB = makePlan({ ...base, courses: coursesB }, brunoCalendar.events, { weeks: 6, today: '2026-11-02' });
  assert.deepEqual(canonicalSchedule(planA), canonicalSchedule(planB));
  assert.deepEqual(minutesByCourse(planA), minutesByCourse(planB));
});

test('preferredPeriod never causes avoidable shortfall on 11:00-13:15 afternoon boundary packing', () => {
  const profile = {
    student: 'boundary-packing',
    timezone: 'America/Sao_Paulo',
    targetHours: 2,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    availabilityThrough: '2026-11-08',
    courses: [{ name: 'Calculus', deadline: '2026-12-01T18:00:00-03:00', source: 'synthetic:calc' }],
    studyWindows: [{ weekday: 3, start: '11:00', end: '13:15' }],
  };

  const plan = makePlan(profile, [], { weeks: 1, preferredPeriod: 'afternoon', today: '2026-11-02' });
  assert.equal(plan.near.length, 2, 'must schedule 120m (2 blocks), not 60m');
  assert.equal(plan.outlook[0].scheduledHours, 2);
  assert.equal(plan.outlook[0].shortfall, 0);
  assert.equal(plan.near[0].start.dateTime, '2026-11-04T11:00:00-03:00');
  assert.equal(plan.near[1].start.dateTime, '2026-11-04T12:15:00-03:00');
});

test('previewPlan is side-effect-free, matches draft on confirmed context, supports candidate records and horizon shortening, and preserves applyApproved staleness checks', async () => {
  const fixture = JSON.parse(await readFile(path.join(ROOT, 'fixtures/calendars/bruno.json'), 'utf8'));
  let items = structuredClone(fixture.events);
  let writeCalls = 0;
  const calendar = {
    events: async () => structuredClone(items),
    create: async (_student, event) => {
      writeCalls++;
      items.push(structuredClone(event));
      return event;
    },
    remove: async (_student, id) => {
      writeCalls++;
      items = items.filter(event => event.id !== id);
    },
  };

  await initializeScenario(calendar, 'bruno', { coldStart: 'bruno-text' });
  const boundary = createStudyBoundary({ student: 'bruno', calendar, coldStart: true });

  const candidateRecord = {
    courses: [
      {
        name: 'Algoritmos',
        date: '2026-12-14',
        time: '09:00',
        citation: {
          path: 'notices/aviso-turma-n02.md',
          quote: 'A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.',
        },
      },
      {
        name: 'Banco de Dados',
        date: '2026-12-14',
        time: '18:00',
        citation: {
          path: 'courses/banco-de-dados.md',
          quote: 'Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo',
        },
      },
    ],
    studyWindows: [
      { weekday: 1, start: '19:00', end: '21:15' },
      { weekday: 3, start: '19:00', end: '21:15' },
      { weekday: 6, start: '14:00', end: '16:15' },
      { weekday: 0, start: '10:00', end: '12:15' },
    ],
    targetHours: 5,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    through: '2026-11-15',
    assumption: 'Two-week candidate preview before confirmation.',
  };

  // 1. Dry-run candidate record via StudyBoundary before any confirmation; state and calendar must stay untouched.
  const stateBeforeCandidate = await loadState('bruno');
  const candidatePreview = await boundary.call('preview_plan', { student: 'bruno', weeks: 2, record: candidateRecord });
  assert.equal(candidatePreview.ok, true);
  assert.equal(candidatePreview.planningContextRevisionId, null);
  assert.deepEqual(candidatePreview.horizon, { weeks: 2, through: '2026-11-15', clampedBy: 'requested' });
  assert.equal(candidatePreview.capacityPerWeek.length, 2);
  assert.ok(candidatePreview.capacityPerWeek.every(row => row.capacityHours >= 5 && row.shortfallHours === 0));
  assert.deepEqual(candidatePreview.findings, []);
  assert.equal(writeCalls, 0);
  assert.deepEqual(await loadState('bruno'), stateBeforeCandidate);

  // Invalid candidate citation must be rejected by validatePlanningContext:
  const badCandidate = structuredClone(candidateRecord);
  badCandidate.courses[0].citation.quote = 'Nonexistent quote from Mars';
  await assert.rejects(() => boundary.call('preview_plan', { student: 'bruno', record: badCandidate }), /Cited quote/);

  // 2. Propose and confirm context; confirmPlanningContext resets state.plan = null.
  const proposed = await proposePlanningContext('bruno', candidateRecord);
  await confirmPlanningContext('bruno', proposed.id, ['Confirming two-week availability.']);
  const stateAfterConfirm = await loadState('bruno');
  assert.equal(stateAfterConfirm.plan, null);

  // 3. previewPlan works immediately after confirmPlanningContext clears state.plan = null,
  //    and leaves state.plan, state.protectedIds, and state.history completely unchanged.
  const confirmedPreview = await previewPlan(calendar, 'bruno', { weeks: 2 }, { requireStaged: true });
  assert.equal(confirmedPreview.ok, true);
  assert.equal(confirmedPreview.planningContextRevisionId, proposed.id);
  assert.equal(confirmedPreview.plan.planningContextRevisionId, proposed.id);
  assert.deepEqual(confirmedPreview.horizon, { weeks: 2, through: '2026-11-15', clampedBy: 'requested' });
  assert.deepEqual(await loadState('bruno'), stateAfterConfirm);
  assert.equal(writeCalls, 0);

  // 4. Explicit horizon shortening (2 weeks -> 1 week) succeeds cleanly without mutating state.
  const shortenedPreview = await boundary.call('preview_plan', { student: 'bruno', weeks: 1 });
  assert.equal(shortenedPreview.ok, true);
  assert.deepEqual(shortenedPreview.horizon, { weeks: 1, through: '2026-11-08', clampedBy: 'requested' });
  assert.equal(shortenedPreview.plan.outlook.length, 1);
  assert.equal(shortenedPreview.plan.near.length, 5);
  assert.equal(shortenedPreview.plan.future.length, 0);
  assert.deepEqual(await loadState('bruno'), stateAfterConfirm);

  // 5. Shortfall candidate produces generic typed finding codes only.
  const tightCandidate = {
    ...candidateRecord,
    studyWindows: [{ weekday: 6, start: '14:00', end: '15:00' }],
    through: '2026-11-08',
  };
  const tightPreview = await boundary.call('preview_plan', { student: 'bruno', weeks: 1, record: tightCandidate });
  assert.equal(tightPreview.ok, false);
  assert.ok(tightPreview.findings.some(f => f.code === 'WEEKLY_SHORTFALL' && f.shortfallHours === 4 && f.capacityHours === 1));
  assert.ok(tightPreview.findings.every(f => typeof f.code === 'string' && /^[A-Z_]+$/.test(f.code)));

  // 6. previewPlan and draft produce identical block schedules and baseHash on the same confirmed context + calendar.
  const drafted = await draft(calendar, 'bruno', { weeks: 2 }, { requireStaged: true });
  assert.equal(confirmedPreview.plan.baseHash, drafted.baseHash);
  assert.deepEqual(canonicalSchedule(confirmedPreview.plan), canonicalSchedule(drafted));
  assert.deepEqual(confirmedPreview.plan.outlook, drafted.outlook);

  // 7. Unseen calendar edit to a study block does NOT mutate state.protectedIds during previewPlan.
  await applyApproved(calendar, 'bruno', drafted.id, 'near');
  const appliedBlockId = drafted.near[0].id;
  items = items.map(ev => (ev.id === appliedBlockId ? { ...ev, summary: 'Edited study block' } : ev));
  const stateBeforeReadOnlyCheck = await loadState('bruno');
  assert.deepEqual(stateBeforeReadOnlyCheck.protectedIds, []);
  const previewAfterEdit = await previewPlan(calendar, 'bruno', { weeks: 2 }, { requireStaged: true });
  assert.ok(!previewAfterEdit.plan.remove.near.some(ev => ev.id === appliedBlockId), 'previewPlan must honor protected IDs read-only');
  assert.deepEqual(await loadState('bruno'), stateBeforeReadOnlyCheck, 'previewPlan must not mutate state.protectedIds, state.plan, or state.history');

  // 8. applyApproved still rejects stale calendar and stale planning context changes.
  await assert.rejects(() => applyApproved(calendar, 'bruno', drafted.id, 'future'), /STALE/);
  const drafted2 = await draft(calendar, 'bruno', { weeks: 2 }, { requireStaged: true });
  await proposePlanningContext('bruno', { ...candidateRecord, targetHours: 4 });
  await assert.rejects(() => applyApproved(calendar, 'bruno', drafted2.id, 'near'), /STALE/);
});

test('anti-leakage strips caseId from POST /sessions and read_planning_context, stages sealed bundles via workspaceSource, blocks ID-keyed answer cheating, and supports 0-LLM trusted draft', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'issue-72-sealed-'));
  t.after(() => rm(work, { recursive: true, force: true }));

  // Verify initializeScenario stages a sealed bundle with an arbitrary caseId when workspaceSource is supplied,
  // while still rejecting unknown coldStart IDs when workspaceSource is omitted.
  const brunoFixture = JSON.parse(await readFile(path.join(ROOT, 'fixtures/calendars/bruno.json'), 'utf8'));
  const sealedWs = path.join(work, 'sealed-workspace');
  await mkdir(path.join(sealedWs, 'courses'), { recursive: true });
  const courseBody = 'Final exam deadline: 2026-12-10 15:00 America/Sao_Paulo.\n';
  await writeFile(path.join(sealedWs, 'courses/sealed-course.md'), courseBody, 'utf8');
  const courseHash = createHash('sha256').update(courseBody).digest('hex');

  const stubCalendar = { events: async () => structuredClone(brunoFixture.events) };
  await assert.rejects(
    () => initializeScenario(stubCalendar, 'bruno', { coldStart: 'sealed-unknown-id' }),
    /Unknown cold-start case/,
  );

  // Build a sealed portable bundle with a non-whitelisted manifest.id ('sealed-case-99')
  const sealedBundleDir = path.join(work, 'sealed-bundle');
  await mkdir(path.join(sealedBundleDir, 'workspace/courses'), { recursive: true });
  await writeFile(path.join(sealedBundleDir, 'workspace/courses/sealed-course.md'), courseBody, 'utf8');
  const calJson = JSON.stringify({ users: brunoFixture.users, calendars: brunoFixture.calendars, events: brunoFixture.events }, null, 2) + '\n';
  const calHash = createHash('sha256').update(calJson).digest('hex');
  await writeFile(path.join(sealedBundleDir, 'calendar.json'), calJson, 'utf8');
  const sealedManifest = {
    version: 1,
    id: 'sealed-case-99',
    student: 'bruno',
    locale: 'en',
    clock: { date: '2026-11-02', timezone: 'America/Sao_Paulo' },
    calendar: { student: 'bruno', sha256: calHash },
    sources: [{ path: 'courses/sealed-course.md', sha256: courseHash }],
    request: 'Plan my study sessions for Sealed Systems over the next two weeks.',
    operator: {
      answers: [
        { id: 'slot_pref', text: 'Mondays, Wednesdays 19:00-21:15, Saturdays 14:00-16:15, Sundays 10:00-12:15 work.' },
        { id: 'load_pref', text: 'Use 5 hours per week, max 2 sessions per day, 15 minute break.' },
      ],
      correction: 'Keep Mondays 2 and 9 November free.',
      approval: 'near',
    },
    expect: {
      deadline: { course: 'Sealed Systems', at: '2026-12-10T15:00:00-03:00', source: 'courses/sealed-course.md' },
      avoidDates: ['2026-11-02', '2026-11-09'],
    },
  };
  await writeFile(path.join(sealedBundleDir, 'case.json'), JSON.stringify(sealedManifest, null, 2) + '\n', 'utf8');
  const sealedBundle = await readBundle(sealedBundleDir);

  // Verify strict matchPreparedAnswer on sealed custom IDs and Ana wording regression (S3):
  const used = new Set();
  assert.equal(matchPreparedAnswer({ id: 'slot_pref', question: 'Unrelated weather question?' }, sealedManifest.operator.answers, used), null);
  assert.equal(matchPreparedAnswer({ id: 'opaque_1', question: 'Which days and time windows work?' }, sealedManifest.operator.answers, used)?.id, 'slot_pref');
  assert.equal(matchPreparedAnswer({ id: 'opaque_2', question: 'How many hours per week and daily limit?' }, sealedManifest.operator.answers, used)?.id, 'load_pref');
  const anaFixtureAnswers = [
    { id: 'availability', text: 'Wednesday, Thursday, and Friday afternoons from 14:00 to 16:15 work.' },
    { id: 'workload', text: 'Plan 4 hours per week, at most 2 sessions per day, with a 15-minute break.' },
    { id: 'preparation', text: 'I have not started an outline yet.' },
  ];
  for (const orderedAnswers of [anaFixtureAnswers, [...anaFixtureAnswers].reverse()]) {
    assert.equal(
      matchPreparedAnswer({ id: 'q_avail', question: 'Which days and time windows work for your study sessions?' }, orderedAnswers, new Set())?.id,
      'availability',
    );
    assert.equal(
      matchPreparedAnswer({ id: 'q_avail_week', question: 'Which days and time windows work for your study sessions each week?' }, orderedAnswers, new Set())?.id,
      'availability',
    );
    assert.equal(
      matchPreparedAnswer({ id: 'q_count_en', question: 'How many study sessions should I schedule each week?' }, orderedAnswers, new Set())?.id,
      'workload',
    );
    assert.equal(
      matchPreparedAnswer({ id: 'q_blocks_en', question: 'How many time blocks should I schedule each week?' }, orderedAnswers, new Set())?.id,
      'workload',
    );
    assert.equal(
      matchPreparedAnswer({ id: 'q_count_pt', question: 'Quantas sessões de estudo por semana?' }, orderedAnswers, new Set())?.id,
      'workload',
    );
  }

  // Verify HTTP adapter never sends caseId on POST /sessions, read_planning_context strips caseId,
  // and 0-LLM trusted draftMode completes replay with zero draft prompts.
  let seenSessionPayload = null;
  let seenContextFromBridge = null;
  const promptTexts = [];
  const http = await import('node:http');
  const sessions = new Map();
  const baseRecord = {
    courses: [{
      name: 'Sealed Systems',
      date: '2026-12-10',
      time: '15:00',
      citation: { path: 'courses/sealed-course.md', quote: 'Final exam deadline: 2026-12-10 15:00 America/Sao_Paulo.' },
    }],
    studyWindows: [
      { weekday: 1, start: '19:00', end: '21:15' },
      { weekday: 3, start: '19:00', end: '21:15' },
      { weekday: 6, start: '14:00', end: '16:15' },
      { weekday: 0, start: '10:00', end: '12:15' },
    ],
    targetHours: 5,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    through: '2026-11-15',
    assumption: 'Sealed bundle availability for two weeks.',
  };

  async function callBridge(bridge, method, args = {}) {
    const res = await fetch(bridge.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-study-run-token': bridge.token },
      body: JSON.stringify({ method, args }),
    });
    const payload = await res.json();
    assert.equal(res.status, 200, JSON.stringify(payload));
    return payload.result;
  }

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const send = (code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.method === 'POST' && req.url === '/sessions') {
      seenSessionPayload = body;
      const sid = 'sealed-sess-1';
      sessions.set(sid, { bridge: body.toolBridge, messages: [], question: null, phase: 'init' });
      return send(200, { sessionId: sid, engine: { name: 'Sealed test runner', revision: '1', mode: 'scripted', model: null, harness: 'test-http' } });
    }
    const parts = req.url.split('/').filter(Boolean);
    const s = sessions.get(parts[1]);
    if (req.method === 'GET') return send(200, { messages: s.messages, question: s.question, busy: false, error: null });
    if (req.method === 'DELETE') {
      sessions.delete(parts[1]);
      return send(200, {});
    }
    if (parts[2] === 'prompt') {
      promptTexts.push(body.text);
      s.messages.push({ type: 'user', text: body.text });
      if (s.phase === 'init') {
        seenContextFromBridge = await callBridge(s.bridge, 'read_planning_context');
        const dryRun = await callBridge(s.bridge, 'preview_plan', { weeks: 2, record: baseRecord });
        assert.equal(dryRun.ok, true);
        s.question = {
          requestId: 'q-1',
          questions: [
            { id: 'route-a', question: 'Which days and time windows work for you?', options: [] },
            { id: 'route-b', question: 'How many hours per week and daily limit?', options: [] },
          ],
        };
        s.phase = 'asked';
      } else if (s.phase === 'proposed') {
        const revised = { ...baseRecord, studyWindows: baseRecord.studyWindows.filter(w => w.weekday !== 1) };
        await callBridge(s.bridge, 'propose_planning_context', { record: revised });
        s.phase = 'revised';
      } else {
        throw new Error(`Unexpected prompt in 0-LLM trusted draft mode: ${body.text}`);
      }
      return send(200, { messages: s.messages, question: s.question, busy: false, error: null });
    }
    if (parts[2] === 'answer') {
      assert.deepEqual(body.answers.map(a => a.id), ['route-a', 'route-b']);
      for (const ans of body.answers) s.messages.push({ type: 'user', text: ans.custom });
      s.question = null;
      await callBridge(s.bridge, 'propose_planning_context', { record: baseRecord });
      s.phase = 'proposed';
      return send(200, { messages: s.messages, question: null, busy: false, error: null });
    }
    return send(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(() => resolve())));

  let events = [];
  let sawIdInMatcher = false;
  const resultPath = path.join(work, 'sealed-result.json');
  const { result, failures } = await runPortableReplay(sealedBundle, 'success', {
    adapter: createHttpRunnerAdapter({ url: `http://127.0.0.1:${server.address().port}` }),
    draftOptions: { weeks: 2 },
    matchAnswer: (asked, answers, usedIds) => {
      if (Object.hasOwn(asked, 'id')) sawIdInMatcher = true;
      return matchPreparedAnswer(asked, answers, usedIds);
    },
    saveResult: async evidence => { await writeFile(resultPath, JSON.stringify(evidence, null, 2) + '\n'); },
    async startExperiment({ fixture, runId }) {
      events = structuredClone(fixture.events);
      return { runId, origin: 'http://127.0.0.1:0', authorize: async () => 'tok', provider: () => ({}), close: async () => {} };
    },
    createCalendar({ faults }) {
      return {
        events: async () => structuredClone(events),
        create: async (_student, event) => { faults.providerAttempts++; events.push(structuredClone(event)); return event; },
        remove: async (_student, id) => { faults.providerAttempts++; events = events.filter(ev => ev.id !== id); },
      };
    },
    observe: async () => structuredClone(events),
    verifyRetired: async () => {},
  });

  assert.deepEqual(failures, []);
  assert.equal(result.caseId, 'sealed-case-99');
  assert.ok(result.checks.every(check => check.outcome === 'pass'), JSON.stringify(result.checks));
  assert.equal(Object.hasOwn(seenSessionPayload, 'caseId'), false, 'POST /sessions must not leak caseId');
  assert.deepEqual(seenContextFromBridge, { pending: null, confirmed: null, previous: null }, 'read_planning_context must omit caseId');
  assert.equal(Object.hasOwn(seenContextFromBridge, 'caseId'), false);
  assert.ok(seenSessionPayload.toolBridge.methods.includes('preview_plan'));
  assert.equal(sawIdInMatcher, false, 'matchAnswer must not receive routing id');
  assert.deepEqual(promptTexts, [sealedManifest.request, sealedManifest.operator.correction], 'default portable replay must use 0-LLM trusted draft mode');

  const probe = await exec('python3', [path.join(ROOT, 'scripts/paired-replay-probe.py'), '--check-result', sealedBundleDir, resultPath]);
  assert.match(probe.stdout, /Checked case sealed-case-99/);
});

test('planner round-robin cursor is unaffected by prior urgency placements and canonical sort distinguishes canonically equivalent Unicode forms', () => {
  const urgentStudent = {
    student: 'ana',
    timezone: 'America/Sao_Paulo',
    targetHours: 3,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    availabilityThrough: '2026-11-08',
    courses: [
      { name: 'Alpha', deadline: '2026-11-10T18:00:00-03:00', source: 's:a' },
      { name: 'Beta', deadline: '2026-11-10T18:00:00-03:00', source: 's:b' },
    ],
    studyWindows: [
      { weekday: 3, start: '14:00', end: '16:15' },
      { weekday: 5, start: '14:00', end: '16:15' },
    ],
  };
  const urgentPlan = makePlan(urgentStudent, [], { weeks: 1, today: '2026-11-02' });
  // Blocks 0 and 1 hit <=14d urgency (Alpha); block 2 hits round-robin cursor 0 (Alpha), not least-placed balancing (Beta).
  assert.deepEqual(
    urgentPlan.near.map(b => b.extendedProperties.private.course),
    ['Alpha', 'Alpha', 'Alpha'],
  );

  const nfc = 'Caf\u00e9';
  const nfd = 'Cafe\u0301';
  const unicodeBase = {
    student: 'ana',
    timezone: 'America/Sao_Paulo',
    targetHours: 2,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    availabilityThrough: '2026-11-08',
    studyWindows: [{ weekday: 3, start: '14:00', end: '16:15' }],
  };
  const p1 = makePlan(
    { ...unicodeBase, courses: [{ name: nfc, deadline: '2026-12-01T18:00:00-03:00', source: 's:1' }, { name: nfd, deadline: '2026-12-01T18:00:00-03:00', source: 's:2' }] },
    [],
    { weeks: 1, today: '2026-11-02' },
  );
  const p2 = makePlan(
    { ...unicodeBase, courses: [{ name: nfd, deadline: '2026-12-01T18:00:00-03:00', source: 's:2' }, { name: nfc, deadline: '2026-12-01T18:00:00-03:00', source: 's:1' }] },
    [],
    { weeks: 1, today: '2026-11-02' },
  );
  assert.deepEqual(
    p1.near.map(b => b.extendedProperties.private.course),
    p2.near.map(b => b.extendedProperties.private.course),
  );
});

test('default non-coldStart study boundary forwards candidate record to preview_plan', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'study-boundary-default-preview-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const events = JSON.parse(await readFile(path.join(ROOT, 'fixtures/calendars/bruno.json'), 'utf8')).events;
  const calendar = {
    events: async () => structuredClone(events),
    create: async () => { throw new Error('preview_plan must not write'); },
    remove: async () => { throw new Error('preview_plan must not remove'); },
  };
  await withSyntheticRuntime(work, async () => {
    await initializeScenario(calendar, 'bruno');
    const boundary = createStudyBoundary({ student: 'bruno', calendar, coldStart: false });
    const res = await boundary.call('preview_plan', {
      student: 'bruno',
      weeks: 1,
      record: {
        courses: [{
          name: 'Algoritmos',
          date: '2026-11-30',
          time: '18:00',
          citation: { path: 'courses.json', quote: '"Algoritmos"' },
        }],
        studyWindows: [{ weekday: 3, start: '19:00', end: '21:15' }],
        targetHours: 2,
        maxDailyStudyHours: 2,
        studyBreakMinutes: 15,
        through: '2026-11-08',
        assumption: 'Candidate record preview on default boundary.',
      },
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.plan.sources.map(c => c.name), ['Algoritmos']);
  });
});
