import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { ROOT } from '../src/core.mjs';
import { packBundle, readBundle } from '../src/paired-replay/bundle.mjs';
import { createHttpRunnerAdapter } from '../src/paired-replay/http-adapter.mjs';
import { runPortableReplay, scenarios } from '../src/paired-replay/runner.mjs';

const exec = promisify(execFile);

const VENV_PYTHON = path.join(ROOT, 'runners/studybuddy-pipeline/.venv/bin/python');

const BRUNO_RECORD = {
  courses: [
    {
      name: 'Algoritmos',
      date: '2026-12-14',
      time: '09:00',
      citation: {
        path: 'notices/aviso-turma-n02.md',
        quote: 'A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.',
      },
      resolution: 'Aviso da turma N02 atualizou a data.',
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
  assumption: 'Disponibilidade provisória para duas semanas.',
};

const ANA_RECORD = {
  courses: [
    {
      name: 'Applied Data Ethics',
      date: '2026-12-01',
      time: '17:30',
      citation: {
        path: 'lms/assessment-export.json',
        quote: '"dueAt": "2026-12-01T20:30:00Z"',
      },
      resolution: 'LMS revision 2 replaces October outline.',
    },
  ],
  studyWindows: [
    { weekday: 3, start: '14:00', end: '16:15' },
    { weekday: 4, start: '14:00', end: '16:15' },
    { weekday: 5, start: '14:00', end: '16:15' },
  ],
  targetHours: 4,
  maxDailyStudyHours: 2,
  studyBreakMinutes: 15,
  through: '2026-11-15',
  assumption: 'Two-week plan keeping weekends open.',
};

function createInMemoryHarness() {
  let events = [];
  return {
    async startExperiment({ fixture, runId }) {
      events = structuredClone(fixture.events);
      return {
        runId,
        origin: 'http://127.0.0.1:0',
        async authorize() { return 'in-memory-token'; },
        provider() { return {}; },
        async close() {},
      };
    },
    createCalendar({ scenario, faults }) {
      return {
        async events() {
          if (scenario === 'unknown-unavailable' && faults.lostResponse) throw new Error('Injected observation loss');
          return structuredClone(events);
        },
        async create(_student, event) {
          faults.providerAttempts++;
          const stored = structuredClone(event);
          events.push(stored);
          if (scenario.startsWith('unknown') && !faults.lostResponse) {
            faults.lostResponse = true;
            throw new Error('Injected loss after calendar accepted a write');
          }
          return stored;
        },
        async remove(_student, id) {
          faults.providerAttempts++;
          events = events.filter(item => item.id !== id);
        },
      };
    },
    async observe() { return structuredClone(events); },
    async editExistingEvent(_experiment, _student, eventId) {
      const target = events.find(item => item.id === eventId);
      target.description = 'Fictional operator edit during the review.';
    },
    async verifyRetired() {},
  };
}

function buildStubReply(body) {
  for (const forbidden of ['temperature', 'top_p', 'top_k', 'presence_penalty', 'tools']) {
    if (Object.hasOwn(body, forbidden)) {
      throw new Error(`Unexpected LLM parameter: ${forbidden}`);
    }
  }
  const messages = body.messages || [];
  const sys = String(messages[0]?.content || '');
  const userText = messages.slice(1).map(m => String(m.content || '')).join('\n');
  const isAna = userText.includes('Applied Data Ethics') || userText.includes('Student: ana') || userText.includes('Estudante: ana');
  const reply = payload => ({
    usage: { prompt_tokens: 100, completion_tokens: 45 },
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(payload) } }],
  });

  if (sys.includes('structured-extraction module')) {
    return reply({
      deadlines: isAna
        ? [{ course: 'Applied Data Ethics', date: '2026-12-01', time: '17:30', source_path: 'lms/assessment-export.json', page: null, quote: '"dueAt": "2026-12-01T20:30:00Z"', is_optional: false, supersedes_earlier: true, resolution_note: 'LMS rev 2' }]
        : [
            { course: 'Algoritmos', date: '2026-12-14', time: '09:00', source_path: 'notices/aviso-turma-n02.md', page: null, quote: 'A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.', is_optional: false, supersedes_earlier: true, resolution_note: 'Aviso N02' },
            { course: 'Banco de Dados', date: '2026-12-14', time: '18:00', source_path: 'courses/banco-de-dados.md', page: null, quote: 'Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo', is_optional: false, supersedes_earlier: false, resolution_note: null },
          ],
      conflicts: [],
      missing_preferences: { studyWindows: true, targetHours: true, maxDailyStudyHours: true, studyBreakMinutes: true, through: !isAna },
      calendar_summary: 'stub',
    });
  }
  if (sys.includes('structured-synthesis module')) {
    return reply(isAna ? ANA_RECORD : BRUNO_RECORD);
  }
  if (sys.includes('structured-revision module')) {
    if (isAna) {
      return reply({ mode: 'avoid_dates_only', avoid_dates: ['2026-11-04'], updated_record: null, rationale: 'Avoid Nov 4' });
    }
    const updated = { ...BRUNO_RECORD, studyWindows: BRUNO_RECORD.studyWindows.filter(w => w.weekday !== 1) };
    return reply({ mode: 'context_update', avoid_dates: ['2026-11-02', '2026-11-09'], updated_record: updated, rationale: 'Drop Mondays' });
  }
  if (sys.includes('agente orquestrador e triagista')) {
    const intent = userText.includes('has_confirmed=True, has_pending=False, already_drafted=False')
      ? 'draft_plan'
      : userText.includes('already_drafted=True')
        ? 'revise_plan'
        : 'initial_plan';
    return reply({ intent, student_goal: 'study', stated_constraints: {}, routing_note: intent });
  }
  if (sys.includes('agente Research')) {
    return reply({
      authoritative_courses: [],
      optional_milestones: [],
      conflicts: [],
      missing_info: ['availability', 'workload'],
      clarification_needed: true,
      questions: isAna
        ? [
            { id: 'availability', question: 'Which windows?', choices: [] },
            { id: 'workload', question: 'Which weekly hours and breaks?', choices: [] },
          ]
        : [{ id: 'availability', question: 'Quais horários, horas e pausa?', choices: [] }],
      calendar_notes: 'stub',
    });
  }
  if (sys.includes('agente Analysis')) {
    if (userText.includes('Modo: revisão de plano já confirmado')) {
      if (isAna) return reply({ action: 'draft_avoid_dates_only', record: null, avoid_dates: ['2026-11-04'], rationale: 'Avoid Nov 4' });
      const updated = { ...BRUNO_RECORD, studyWindows: BRUNO_RECORD.studyWindows.filter(w => w.weekday !== 1) };
      return reply({ action: 'propose_context', record: updated, avoid_dates: ['2026-11-02', '2026-11-09'], rationale: 'Drop Mondays' });
    }
    return reply({ action: 'propose_context', record: isAna ? ANA_RECORD : BRUNO_RECORD, avoid_dates: [], rationale: 'Initial context' });
  }
  if (sys.includes('agente Validation')) {
    return reply({ approved: !userText.includes('"severity": "error"'), overload_risk: false, violations: [], summary: 'ok' });
  }
  if (sys.includes('agente Communication')) {
    return reply({ markdown: 'Proposta e rastro prontos.' });
  }
  throw new Error(`Unexpected prompt: ${sys.slice(0, 80)}`);
}

async function startStubLlmServer() {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const payload = buildStubReply(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

async function spawnPythonPipeline({ pipeline, baseUrl, model }) {
  const child = spawn(
    VENV_PYTHON,
    ['-m', 'studybuddy_pipeline.cli', '--pipeline', pipeline, '--base-url', baseUrl, '--model', model, '--port', '0', '--mode', 'scripted'],
    {
      cwd: path.join(ROOT, 'runners/studybuddy-pipeline'),
      env: { ...process.env, STUDY_RUNNER_API_KEY: 'stub-key' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const ready = await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pipeline} ready line. stderr=${stderr}`)), 15_000);
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Python ${pipeline} runner exited early (${code}): ${stderr}`));
    });
    child.stdout.on('data', chunk => {
      stdout += chunk;
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.ready && parsed.url) {
            clearTimeout(timer);
            resolve(parsed);
            return;
          }
        } catch {
          // Wait for complete JSON line
        }
      }
    });
  });
  return {
    url: ready.url,
    async close() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
        child.once('exit', () => { clearTimeout(t); resolve(); });
      });
    },
  };
}

test('studybuddy-pipeline package has zero DSH, MCP, LangGraph, or CrewAI dependencies', async () => {
  const files = [
    'runners/studybuddy-pipeline/pyproject.toml',
    'runners/studybuddy-pipeline/src/studybuddy_pipeline/contracts.py',
    'runners/studybuddy-pipeline/src/studybuddy_pipeline/tool_bridge.py',
    'runners/studybuddy-pipeline/src/studybuddy_pipeline/llm_client.py',
    'runners/studybuddy-pipeline/src/studybuddy_pipeline/verifier.py',
    'runners/studybuddy-pipeline/src/studybuddy_pipeline/pipeline_a1.py',
    'runners/studybuddy-pipeline/src/studybuddy_pipeline/pipeline_a2.py',
    'runners/studybuddy-pipeline/src/studybuddy_pipeline/app.py',
    'runners/studybuddy-pipeline/src/studybuddy_pipeline/cli.py',
  ];
  for (const rel of files) {
    const content = await readFile(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(content, /@deepseek-ai\/dsh|langgraph|crewai|langchain/i, `${rel} must remain lightweight without heavy agent frameworks or DSH`);
  }
});

test('StudyBuddy Python pipelines A1 & A2 pass all 5 safety scenarios on bruno & ana-held-out and pass probe', async t => {
  if (!existsSync(VENV_PYTHON)) {
    if (process.env.CI) assert.fail(`Missing Python runner virtualenv at ${VENV_PYTHON}`);
    t.skip(`Skipping Python runner test because ${VENV_PYTHON} is not present`);
    return;
  }

  const work = await mkdtemp(path.join(tmpdir(), 'studybuddy-pipelines-'));
  t.after(() => rm(work, { recursive: true, force: true }));

  const bundles = {};
  for (const caseId of ['bruno', 'ana-held-out']) {
    const dir = path.join(work, caseId);
    await packBundle(caseId, dir);
    bundles[caseId] = { dir, bundle: await readBundle(dir) };
  }

  const stubLlm = await startStubLlmServer();
  t.after(() => stubLlm.close());

  for (const pipeline of ['a1', 'a2']) {
    const runner = await spawnPythonPipeline({ pipeline, baseUrl: stubLlm.baseUrl, model: `stub-${pipeline}` });
    t.after(() => runner.close());

    for (const caseId of ['bruno', 'ana-held-out']) {
      for (const scenario of scenarios) {
        const harness = createInMemoryHarness();
        const resultPath = path.join(work, `${pipeline}-${caseId}-${scenario}.json`);
        const { result, failures } = await runPortableReplay(bundles[caseId].bundle, scenario, {
          adapter: createHttpRunnerAdapter({ url: runner.url }),
          saveResult: async evidence => { await writeFile(resultPath, JSON.stringify(evidence, null, 2) + '\n'); },
          ...harness,
        });
        assert.deepEqual(failures, [], `Unexpected failure for ${pipeline}/${caseId}/${scenario}`);
        assert.equal(result.retirement, 'verified');
        assert.equal(result.engine.harness, `studybuddy-pipeline-${pipeline}-v1`);
        assert.equal(result.usage.availability, 'available');
        assert.ok(result.usage.inputTokens > 0 && result.usage.outputTokens > 0);
        assert.ok(result.engine.tools.includes('propose_planning_context'));
        assert.ok(result.engine.tools.includes('draft_study_plan'));
        assert.ok(result.checks.every(c => c.outcome === 'pass'), `Failed checks in ${pipeline}/${caseId}/${scenario}: ${JSON.stringify(result.checks)}`);

        const probe = await exec('python3', [path.join(ROOT, 'scripts/paired-replay-probe.py'), '--check-result', bundles[caseId].dir, resultPath]);
        assert.match(probe.stdout, new RegExp(`Checked case ${caseId}`));

        const traceRes = await fetch(`${runner.url}/runs/${encodeURIComponent(result.runId)}/trace`);
        assert.equal(traceRes.status, 200);
        const trace = await traceRes.json();
        assert.equal(trace.pipeline, pipeline);
        assert.ok(Array.isArray(trace.rastro) && trace.rastro.length >= 3);
      }
    }
    await runner.close();
  }
});
