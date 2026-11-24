import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { ROOT } from '../src/core.mjs';
import { packBundle, readBundle } from '../src/paired-replay/bundle.mjs';
import { createHttpRunnerAdapter } from '../src/paired-replay/http-adapter.mjs';
import { runPortableReplay } from '../src/paired-replay/runner.mjs';
import { createOpenAICompatibleCompleter, startSingleAgentServer } from '../src/runners/single-agent/server.mjs';

const exec = promisify(execFile);

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

async function startFakeOpenAIServer(responder) {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const payload = await responder(body, req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

test('single-agent runner files have zero dependency on @deepseek-ai/dsh or MCP SDK', async () => {
  const files = [
    'src/runners/single-agent/tool-definitions.mjs',
    'src/runners/single-agent/agent-loop.mjs',
    'src/runners/single-agent/server.mjs',
    'scripts/single-agent-runner.mjs',
  ];
  for (const rel of files) {
    const content = await readFile(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(content, /@deepseek-ai\/dsh/, `${rel} must not depend on DSH`);
    assert.doesNotMatch(content, /@modelcontextprotocol\/sdk/, `${rel} must not depend on MCP SDK`);
  }
});

test('non-DSH single-agent HTTP runner completes Bruno success and stale replays over OpenAI-compatible completions', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'single-agent-bruno-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const bundleDir = path.join(work, 'bruno');
  await packBundle('bruno', bundleDir);
  const bundle = await readBundle(bundleDir);

  const brunoRecord = {
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
    through: '2026-11-15',
    targetHours: 5,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    assumption: 'Disponibilidade provisória para duas semanas, sujeita ao calendário.',
  };

  let sawForbiddenRejection = false;
  const fakeLlm = await startFakeOpenAIServer(body => {
    const msgs = body.messages;
    const last = msgs[msgs.length - 1];
    const toolNames = new Set(body.tools.map(item => item.function.name));
    assert.ok(toolNames.has('ask_user_question'));
    assert.ok(toolNames.has('draft_study_plan'));
    assert.ok(!toolNames.has('applyApproved'));

    if (last.role === 'user' && last.content.includes('Algoritmos')) {
      return {
        usage: { prompt_tokens: 120, completion_tokens: 40 },
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'list_synthetic_files', arguments: JSON.stringify({ path: 'courses' }) } },
              { id: 'c2', type: 'function', function: { name: 'read_synthetic_file', arguments: JSON.stringify({ path: 'notices/aviso-turma-n02.md' }) } },
              { id: 'c3', type: 'function', function: { name: 'list_calendar', arguments: '{}' } },
              // Deliberately probe an unauthorized write call to verify StudyBoundary rejects it gracefully:
              { id: 'c4', type: 'function', function: { name: 'applyApproved', arguments: JSON.stringify({ planId: 'x', section: 'near' }) } },
              {
                id: 'c5',
                type: 'function',
                function: {
                  name: 'ask_user_question',
                  arguments: JSON.stringify({
                    requestId: 'availability',
                    questions: [{ id: 'availability', question: 'Quantas horas e janelas funcionam?', options: [] }],
                  }),
                },
              },
            ],
          },
        }],
      };
    }
    if (last.role === 'tool' && last.tool_call_id === 'c5') {
      const forbiddenReply = JSON.parse(msgs.find(m => m.tool_call_id === 'c4').content);
      assert.equal(forbiddenReply.isError, true);
      assert.equal(forbiddenReply.status, 403);
      sawForbiddenRejection = true;
      return {
        usage: { prompt_tokens: 150, completion_tokens: 55 },
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c6', type: 'function', function: { name: 'propose_planning_context', arguments: JSON.stringify({ record: brunoRecord }) } }],
          },
        }],
      };
    }
    if (last.role === 'tool' && (last.tool_call_id === 'c6' || last.tool_call_id === 'c8')) {
      return {
        usage: { prompt_tokens: 100, completion_tokens: 20 },
        choices: [{ message: { role: 'assistant', content: 'Contexto enviado para revisão.' } }],
      };
    }
    if (last.role === 'user' && last.content.includes('Gere a proposta')) {
      return {
        usage: { prompt_tokens: 110, completion_tokens: 30 },
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: `draft-${msgs.length}`, type: 'function', function: { name: 'draft_study_plan', arguments: JSON.stringify({ weeks: 2 }) } }],
          },
        }],
      };
    }
    if (last.role === 'tool' && last.tool_call_id.startsWith('draft-')) {
      return {
        usage: { prompt_tokens: 90, completion_tokens: 25 },
        choices: [{ message: { role: 'assistant', content: 'Proposta pronta para aprovação separada.' } }],
      };
    }
    if (last.role === 'user' && last.content.includes('segundas-feiras')) {
      const revised = { ...brunoRecord, studyWindows: brunoRecord.studyWindows.filter(w => w.weekday !== 1) };
      return {
        usage: { prompt_tokens: 130, completion_tokens: 45 },
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c8', type: 'function', function: { name: 'propose_planning_context', arguments: JSON.stringify({ record: revised }) } }],
          },
        }],
      };
    }
    throw new Error(`Unexpected fake LLM message: ${JSON.stringify(last)}`);
  });
  t.after(() => fakeLlm.close());

  const runnerServer = await startSingleAgentServer({
    completeChat: createOpenAICompatibleCompleter({ baseUrl: fakeLlm.baseUrl, apiKey: 'test-key' }),
    model: 'fake-openai-compat',
    mode: 'scripted',
  });
  t.after(() => runnerServer.close());

  for (const scenario of ['success', 'stale']) {
    const harness = createInMemoryHarness();
    const resultPath = path.join(work, `single-bruno-${scenario}.json`);
    const { result, failures } = await runPortableReplay(bundle, scenario, {
      adapter: createHttpRunnerAdapter({ url: runnerServer.url }),
      saveResult: async evidence => { await writeFile(resultPath, JSON.stringify(evidence, null, 2) + '\n'); },
      ...harness,
    });
    assert.deepEqual(failures, [], `Unexpected failure in ${scenario}`);
    assert.equal(result.retirement, 'verified');
    assert.equal(result.engine.harness, 'single-agent-http-v1');
    assert.equal(result.engine.model, 'fake-openai-compat');
    assert.equal(result.usage.availability, 'available');
    assert.ok(result.usage.inputTokens > 0 && result.usage.outputTokens > 0);
    assert.ok(result.checks.every(check => check.outcome === 'pass'), JSON.stringify(result.checks));
    const probe = await exec('python3', [path.join(ROOT, 'scripts/paired-replay-probe.py'), '--check-result', bundleDir, resultPath]);
    assert.match(probe.stdout, /Checked case bruno/);
  }
  assert.equal(sawForbiddenRejection, true);
});

test('non-DSH single-agent HTTP runner handles ana-held-out grouped + sequential questions and enforces maxSteps', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'single-agent-ana-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const bundleDir = path.join(work, 'ana-held-out');
  await packBundle('ana-held-out', bundleDir);
  const bundle = await readBundle(bundleDir);

  const anaRecord = {
    courses: [{
      name: 'Applied Data Ethics',
      date: '2026-12-01',
      time: '17:30',
      citation: { path: 'lms/assessment-export.json', quote: '"dueAt": "2026-12-01T20:30:00Z"' },
      resolution: 'LMS export supersedes the earlier module outline date.',
    }],
    studyWindows: [
      { weekday: 3, start: '14:00', end: '16:15' },
      { weekday: 4, start: '14:00', end: '16:15' },
      { weekday: 5, start: '14:00', end: '16:15' },
    ],
    through: '2026-11-15',
    targetHours: 4,
    maxDailyStudyHours: 2,
    studyBreakMinutes: 15,
    assumption: 'Two-week plan keeping weekends open.',
  };

  let draftCount = 0;
  const runnerServer = await startSingleAgentServer({
    model: 'fake-ana-model',
    mode: 'scripted',
    async completeChat({ messages }) {
      const last = messages[messages.length - 1];
      if (last.role === 'user' && last.content.includes('Applied Data Ethics')) {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'a1',
                type: 'function',
                function: {
                  name: 'ask_user_question',
                  arguments: JSON.stringify({
                    requestId: 'ana-intake',
                    questions: [
                      { id: 'availability', groupId: 'intake', question: 'Which windows work?', options: [] },
                      { id: 'workload', groupId: 'intake', question: 'How many weekly hours?', options: [] },
                    ],
                  }),
                },
              }],
            },
          }],
        };
      }
      if (last.role === 'tool' && last.tool_call_id === 'a1') {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'a2',
                type: 'function',
                function: {
                  name: 'ask_user_question',
                  arguments: JSON.stringify({
                    requestId: 'ana-prep',
                    questions: [{ id: 'preparation', question: 'Have you started an outline?', options: [] }],
                  }),
                },
              }],
            },
          }],
        };
      }
      if (last.role === 'tool' && last.tool_call_id === 'a2') {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'a3', type: 'function', function: { name: 'propose_planning_context', arguments: JSON.stringify({ record: anaRecord }) } }],
            },
          }],
        };
      }
      if (last.role === 'tool' && (last.tool_call_id === 'a3' || last.tool_call_id === 'a5')) {
        return { choices: [{ message: { role: 'assistant', content: 'Context submitted for review.' } }] };
      }
      if (last.role === 'user' && last.content.includes('Draft the reviewable')) {
        draftCount++;
        const args = draftCount === 1 ? { weeks: 2 } : { weeks: 2, avoidDates: ['2026-11-04'] };
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: `adraft-${draftCount}`, type: 'function', function: { name: 'draft_study_plan', arguments: JSON.stringify(args) } }],
            },
          }],
        };
      }
      if (last.role === 'tool' && last.tool_call_id.startsWith('adraft-')) {
        return { choices: [{ message: { role: 'assistant', content: 'Proposal ready.' } }] };
      }
      if (last.role === 'user' && last.content.includes('4 November')) {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'a5', type: 'function', function: { name: 'propose_planning_context', arguments: JSON.stringify({ record: anaRecord }) } }],
            },
          }],
        };
      }
      throw new Error(`Unexpected message: ${JSON.stringify(last)}`);
    },
  });
  t.after(() => runnerServer.close());

  const harness = createInMemoryHarness();
  const resultPath = path.join(work, 'single-ana.json');
  const { result, failures } = await runPortableReplay(bundle, 'success', {
    adapter: createHttpRunnerAdapter({ url: runnerServer.url }),
    saveResult: async evidence => { await writeFile(resultPath, JSON.stringify(evidence, null, 2) + '\n'); },
    ...harness,
  });
  assert.deepEqual(failures, []);
  assert.equal(result.caseId, 'ana-held-out');
  assert.equal(result.usage.availability, 'unknown');
  assert.ok(result.checks.every(check => check.outcome === 'pass'), JSON.stringify(result.checks));
  const probe = await exec('python3', [path.join(ROOT, 'scripts/paired-replay-probe.py'), '--check-result', bundleDir, resultPath]);
  assert.match(probe.stdout, /Checked case ana-held-out/);

  // Verify runaway loop halts cleanly at maxSteps without hanging:
  const loopServer = await startSingleAgentServer({
    model: 'loop-model',
    maxSteps: 2,
    async completeChat() {
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'loop-1', type: 'function', function: { name: 'list_calendar', arguments: '{}' } }],
          },
        }],
      };
    },
  });
  t.after(() => loopServer.close());
  const bridgeStub = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: { events: [] } }));
  });
  await new Promise(resolve => bridgeStub.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => bridgeStub.close(() => resolve())));
  const started = await (await fetch(`${loopServer.url}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      student: 'ana',
      locale: 'en',
      clock: { date: '2026-11-02', timezone: 'America/Sao_Paulo' },
      toolBridge: { url: `http://127.0.0.1:${bridgeStub.address().port}/tools/call`, token: 'tok', methods: ['list_calendar'] },
    }),
  })).json();
  const snap = await (await fetch(`${loopServer.url}/sessions/${started.sessionId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Plan my week' }),
  })).json();
  assert.match(snap.error, /maxSteps \(2\)/);
});

test('single-agent loop preserves reasoning_details across tool steps and emits onEvent traces', async t => {
  const seenRequests = [];
  const events = [];
  let callIndex = 0;

  const runnerServer = await startSingleAgentServer({
    model: 'reasoning-model',
    onEvent: ev => events.push(ev),
    async completeChat({ messages }) {
      seenRequests.push(structuredClone(messages));
      callIndex++;
      if (callIndex === 1) {
        return {
          usage: { prompt_tokens: 50, completion_tokens: 20 },
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              reasoning_details: [{ type: 'reasoning.text', text: 'check calendar first' }],
              tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'list_calendar', arguments: '{}' } }],
            },
          }],
        };
      }
      return {
        usage: { prompt_tokens: 80, completion_tokens: 15 },
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'All clear.' } }],
      };
    },
  });
  t.after(() => runnerServer.close());

  const bridgeStub = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: { events: [] } }));
  });
  await new Promise(resolve => bridgeStub.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => bridgeStub.close(() => resolve())));

  const started = await (await fetch(`${runnerServer.url}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      student: 'bruno',
      locale: 'pt-BR',
      clock: { date: '2026-11-02', timezone: 'America/Sao_Paulo' },
      toolBridge: { url: `http://127.0.0.1:${bridgeStub.address().port}/tools/call`, token: 'tok', methods: ['list_calendar'] },
    }),
  })).json();
  const snap = await (await fetch(`${runnerServer.url}/sessions/${started.sessionId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Check calendar' }),
  })).json();
  assert.equal(snap.error, null);
  assert.equal(seenRequests.length, 2);
  const assistantTurn = seenRequests[1].find(msg => msg.role === 'assistant');
  assert.deepEqual(assistantTurn.reasoning_details, [{ type: 'reasoning.text', text: 'check calendar first' }]);
  assert.equal(events.filter(ev => ev.type === 'llm_step').length, 2);
  assert.equal(events.filter(ev => ev.type === 'tool' && ev.name === 'list_calendar').length, 1);
});
