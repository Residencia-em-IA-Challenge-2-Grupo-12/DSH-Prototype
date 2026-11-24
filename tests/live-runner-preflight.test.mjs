import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compactCalendarEvent, compactCalendarEvents } from '../src/foundation/calendar-view.mjs';
import { createModelBudget } from '../src/foundation/model-budget.mjs';
import { createOpenRouterGateway } from '../src/foundation/openrouter-gateway.mjs';
import { OPENROUTER_MODEL, prepareOpenRouterRequest } from '../src/foundation/openrouter-policy.mjs';
import { createStudyBoundary } from '../src/foundation/study-boundary.mjs';
import { createOpenAICompatibleCompleter, startSingleAgentServer } from '../src/runners/single-agent/server.mjs';
import { buildOpenAITools } from '../src/runners/single-agent/tool-definitions.mjs';

function hasKeyDeep(node, targetKey) {
  if (Array.isArray(node)) return node.some(item => hasKeyDeep(item, targetKey));
  if (!node || typeof node !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(node, targetKey)) return true;
  return Object.values(node).some(value => hasKeyDeep(value, targetKey));
}

test('compact list_calendar preserves scheduling fields and cuts Bruno and Ana payload size by >55%', async () => {
  for (const student of ['bruno', 'ana']) {
    const fixture = JSON.parse(await readFile(new URL(`../fixtures/calendars/${student}.json`, import.meta.url), 'utf8'));
    const calendar = { events: async () => structuredClone(fixture.events) };
    const boundary = createStudyBoundary({ student, calendar });
    const result = await boundary.call('list_calendar', { student });

    assert.equal(result.events.length, fixture.events.length);
    const rawBytes = Buffer.byteLength(JSON.stringify(fixture.events), 'utf8');
    const compactBytes = Buffer.byteLength(JSON.stringify(result.events), 'utf8');
    const savingsRatio = 1 - compactBytes / rawBytes;
    assert.ok(savingsRatio >= 0.55, `${student} expected >=55% reduction, got ${Math.round(savingsRatio * 100)}%`);

    for (let i = 0; i < fixture.events.length; i++) {
      const raw = fixture.events[i];
      const compact = result.events[i];
      assert.equal(compact.id, raw.id);
      assert.equal(compact.summary, raw.summary);
      assert.equal(compact.start, raw.start?.dateTime || raw.start?.date);
      assert.equal(compact.end, raw.end?.dateTime || raw.end?.date);
      assert.equal(compact.etag, undefined);
      assert.equal(compact.htmlLink, undefined);
      if (raw.status && raw.status !== 'confirmed') assert.equal(compact.status, raw.status);
      else assert.equal(compact.status, undefined);
      if (raw.transparency && raw.transparency !== 'opaque') assert.equal(compact.transparency, raw.transparency);
      else assert.equal(compact.transparency, undefined);
    }
  }

  const studyEvent = compactCalendarEvent({
    id: 'study-1',
    summary: 'Estudo: Algoritmos',
    start: { dateTime: '2026-11-03T19:00:00-03:00' },
    end: { dateTime: '2026-11-03T20:00:00-03:00' },
    status: 'tentative',
    transparency: 'transparent',
    description: 'Revisão de grafos',
    location: 'Biblioteca',
    extendedProperties: { private: { studyDemo: 'true', course: 'Algoritmos' } },
  });
  assert.deepEqual(studyEvent, {
    id: 'study-1',
    summary: 'Estudo: Algoritmos',
    start: '2026-11-03T19:00:00-03:00',
    end: '2026-11-03T20:00:00-03:00',
    status: 'tentative',
    transparency: 'transparent',
    description: 'Revisão de grafos',
    location: 'Biblioteca',
    studyBlock: true,
    course: 'Algoritmos',
  });
  assert.deepEqual(compactCalendarEvents(null), []);
});

test('single-agent tool definitions support gemini schema compatibility and reasoning_effort forwarding', async t => {
  const allMethods = [
    'list_synthetic_files',
    'read_synthetic_file',
    'list_calendar',
    'read_planning_context',
    'propose_planning_context',
    'draft_study_plan',
    'preview_study_options',
    'inspect_checkpoint',
    'routine_report',
    'save_report_interpretation',
  ];

  const standardTools = buildOpenAITools(allMethods, { schemaCompat: 'standard' });
  const geminiTools = buildOpenAITools(allMethods, { schemaCompat: 'gemini' });
  assert.equal(geminiTools.length, standardTools.length);
  assert.equal(hasKeyDeep(standardTools, 'additionalProperties'), true);
  assert.equal(hasKeyDeep(geminiTools, 'additionalProperties'), false);
  assert.throws(() => buildOpenAITools(allMethods, { schemaCompat: 'unknown' }), /Unsupported schemaCompat/i);
  assert.throws(
    () => createOpenAICompatibleCompleter({ baseUrl: 'http://127.0.0.1:1/v1', reasoningEffort: 'turbo' }),
    /Unsupported reasoningEffort/i,
  );

  const capturedBodies = [];
  const fakeUpstream = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    capturedBodies.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      usage: { prompt_tokens: 42, completion_tokens: 12 },
      choices: [{ message: { role: 'assistant', content: 'Ready.' } }],
    }));
  });
  await new Promise(resolve => fakeUpstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => fakeUpstream.close(() => resolve())));

  const baseUrl = `http://127.0.0.1:${fakeUpstream.address().port}/v1`;
  const runnerServer = await startSingleAgentServer({
    completeChat: createOpenAICompatibleCompleter({ baseUrl, apiKey: 'test', reasoningEffort: 'low' }),
    model: 'gemini-4-hydrogen',
    schemaCompat: 'gemini',
  });
  t.after(() => runnerServer.close());

  const health = await (await fetch(`${runnerServer.url}/health`)).json();
  assert.equal(health.schemaCompat, 'gemini');

  const bridgeStub = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: {} }));
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
      toolBridge: { url: `http://127.0.0.1:${bridgeStub.address().port}/tools/call`, token: 'tok', methods: allMethods },
    }),
  })).json();
  const snap = await (await fetch(`${runnerServer.url}/sessions/${started.sessionId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Oi' }),
  })).json();
  assert.equal(snap.error, null);
  assert.equal(capturedBodies.length, 1);
  assert.equal(capturedBodies[0].reasoning_effort, 'low');
  assert.equal(hasKeyDeep(capturedBodies[0].tools, 'additionalProperties'), false);

  // Without reasoningEffort, the field must not be sent at all:
  const plainCompleter = createOpenAICompatibleCompleter({ baseUrl, apiKey: 'test' });
  await plainCompleter({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [] });
  assert.equal(Object.prototype.hasOwnProperty.call(capturedBodies[1], 'reasoning_effort'), false);
});

test('OpenRouter policy and gateway support explicit caller allowlists while preserving strict safety guards', async t => {
  const defaultReq = prepareOpenRouterRequest({
    model: OPENROUTER_MODEL,
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.deepEqual(defaultReq.provider, { only: ['deepseek'], allow_fallbacks: false, require_parameters: true });
  assert.throws(() => prepareOpenRouterRequest({ model: 'meta/muse-ember', messages: [{ role: 'user', content: 'hi' }] }), /Unauthorized/i);

  const customPolicy = { allowedModels: ['meta/muse-ember', 'openai/gpt-6-luna'] };
  const museReq = prepareOpenRouterRequest(
    { model: 'meta/muse-ember', messages: [{ role: 'user', content: 'hi' }], max_tokens: 512 },
    customPolicy,
  );
  assert.equal(museReq.model, 'meta/muse-ember');
  assert.deepEqual(museReq.provider, { allow_fallbacks: false, require_parameters: true });
  assert.equal(museReq.usage.include, true);
  assert.throws(
    () => prepareOpenRouterRequest({ model: 'meta/muse-ember', models: ['openai/gpt-6-luna'], messages: [{ role: 'user', content: 'hi' }] }, customPolicy),
    /fallback/i,
  );
  assert.throws(
    () => prepareOpenRouterRequest({ model: 'meta/muse-ember', plugins: [{ id: 'web' }], messages: [{ role: 'user', content: 'hi' }] }, customPolicy),
    /plugins/i,
  );
  assert.throws(
    () => prepareOpenRouterRequest({ model: 'unlisted/model', messages: [{ role: 'user', content: 'hi' }] }, customPolicy),
    /Unauthorized/i,
  );

  // End-to-end loopback smoke: single-agent completer -> budgeted OpenRouter gateway with custom allowlist
  const dir = await mkdtemp(path.join(tmpdir(), 'study-openrouter-custom-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const budget = await createModelBudget({ directory: dir });
  t.after(() => budget.close());

  assert.throws(() => createOpenRouterGateway({
    apiKey: 'k',
    accessToken: 'tok',
    budget,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.5, verifiedAt: new Date().toISOString() },
    policy: { allowedModels: [] },
  }), /allowed model/i);

  const upstreamRequests = [];
  const gateway = createOpenRouterGateway({
    apiKey: 'synthetic-key',
    accessToken: 'gw-token',
    budget,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.5, verifiedAt: new Date().toISOString() },
    policy: customPolicy,
    fetchImpl: async (_url, options) => {
      upstreamRequests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        model: 'meta/muse-ember',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { cost: 0.0003, prompt_tokens: 80, completion_tokens: 16 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await new Promise((resolve, reject) => gateway.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => gateway.close(() => resolve())));

  const gatewayUrl = `http://127.0.0.1:${gateway.address().port}/v1`;
  const completer = createOpenAICompatibleCompleter({ baseUrl: gatewayUrl, apiKey: 'gw-token' });
  const completion = await completer({
    model: 'meta/muse-ember',
    messages: [{ role: 'user', content: 'Smoke test' }],
    tools: buildOpenAITools(['list_calendar']),
  });
  assert.equal(completion.choices[0].message.content, 'ok');
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].model, 'meta/muse-ember');
  assert.equal(upstreamRequests[0].provider.allow_fallbacks, false);
  assert.equal((await budget.summary()).observedUsd, 0.0003);

  await assert.rejects(
    completer({ model: 'deepseek/deepseek-v4.1-flash-1017', messages: [{ role: 'user', content: 'Blocked' }], tools: [] }),
    /400/,
  );
  assert.equal(upstreamRequests.length, 1);
});
