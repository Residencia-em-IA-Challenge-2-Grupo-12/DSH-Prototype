import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  Calendarpit, assertStudent, disposeSyntheticRuntime, draft, initializeScenario, inspectPdf, listWorkspace,
  previewPlan, proposePlanningContext, readWorkspace, readWorkspacePageRange, withSyntheticRuntime,
} from '../src/core.mjs';
import { createDisclosedSources, validatePlanningContext } from '../src/cold-start-context.mjs';
import { CalendarpitApi } from '../src/foundation/calendarpit-api.mjs';
import { createEvalGateway } from '../src/foundation/eval-gateway.mjs';
import { createModelBudget, formatUsd } from '../src/foundation/model-budget.mjs';
import { authorizeSyntheticCalendar } from '../src/foundation/synthetic-calendar-auth.mjs';
import { createTrustedStudyService } from '../src/foundation/trusted-study-service.mjs';
import { createHttpRunnerAdapter } from '../src/paired-replay/http-adapter.mjs';
import { createOpenAICompatibleCompleter, startSingleAgentServer } from '../src/runners/single-agent/server.mjs';
import { buildOpenAITools, buildSystemPrompt } from '../src/runners/single-agent/tool-definitions.mjs';
import { formatSummaryMarkdown } from '../scripts/compare-live-models.mjs';

const student = 'sealed-case_21';
const allowedStudents = ['ravi', student, 'ana'];
const staged = { requireStaged: true, allowedStudents };
const clock = { date: '2026-05-01', timezone: 'America/Sao_Paulo' };
const transport = 'compose-eval';
const callback = 'http://127.0.0.1:4175/callback';
const subject = 'Aquatic Ecology';
const pdfPath = 'assessment.pdf';
const quote = page => `Aquatic Ecology assessment instructions on page ${page}`;
const record = (citation = { path: pdfPath, page: 2, quote: quote(2) }) => ({
  courses: [{ name: subject, date: '2026-05-30', time: '18:00', citation }],
  studyWindows: [{ weekday: 1, start: '14:00', end: '16:00' }],
  targetHours: 2,
  maxDailyStudyHours: 2,
  studyBreakMinutes: 0,
  through: '2026-05-31',
  assumption: 'Uses the weekly window confirmed by the operator.',
});

async function tempDir(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'study-slice1-'));
  t.after(async () => {
    await disposeSyntheticRuntime(root);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

const post = (url, body, headers) => fetch(url, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
});

function pdf(pageCount) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let page = 1; page <= pageCount; page++) {
    const content = page === 3 ? '' : `BT /F1 12 Tf 20 100 Td (${quote(page)}) Tj ET\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${3 + page * 2} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  }
  let body = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  for (const [index, object] of objects.entries()) {
    offsets.push(`${String(body.length).padStart(10, '0')} 00000 n \n`);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  return `${body}xref\n0 ${offsets.length}\n${offsets.join('')}trailer\n<< /Root 1 0 R /Size ${offsets.length} >>\nstartxref\n${body.length}\n%%EOF\n`;
}

test('explicit and scoped student allowlists stage Ravi and sealed identities without development data', async t => {
  const root = await tempDir(t);
  const source = path.join(root, 'source');
  await mkdir(source);
  await writeFile(path.join(source, 'assessment.txt'), 'Assessment: 2026-05-30 at 18:00');
  await writeFile(path.join(source, 'courses.json'), JSON.stringify({
    ...record(), courses: [{ name: subject, source: 'assessment.txt' }],
  }));
  const fixture = { users: [{ id: 'ravi' }], calendars: [], events: [] };
  const calls = [];
  const base = await listen(t, createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push([req.url, chunks.length ? JSON.parse(Buffer.concat(chunks)) : null]);
    json(res, { items: [] });
  }));
  assert.throws(() => assertStudent('ravi'), /Unknown fixture/);
  assert.throws(() => assertStudent('../ana', ['../ana']), /Unknown fixture/);
  const calendar = new Calendarpit(base, { fixture });
  const service = await withSyntheticRuntime(root, async () => {
    const state = await initializeScenario(calendar, 'ravi', { ...staged, calendarFixture: fixture, workspaceSource: source });
    assert.deepEqual(state.feedback, []);
    assert.deepEqual((await listWorkspace('ravi', '', staged)).map(entry => entry.name).sort(), ['assessment.txt', 'courses.json']);
    assert.equal(await readWorkspace('ravi', 'assessment.txt', staged), 'Assessment: 2026-05-30 at 18:00');
    const plan = await previewPlan(calendar, 'ravi', { weeks: 1 }, { ...staged, today: clock.date });
    assert.equal(plan.ok, true);
    assert.ok((await draft(calendar, 'ravi', { weeks: 1 }, { ...staged, today: clock.date })).id);
    return withSyntheticRuntime(root, async () => {
      await initializeScenario(calendar, student, { workspaceSource: source, coldStart: 'sealed', expectedEvents: [] });
      assert.equal(assertStudent(student), student);
      await calendar.reset('ravi');
      return createTrustedStudyService({ student, calendar, coldStart: true, clock });
    }, staged);
  });
  const proposed = await service.agent.call('propose_planning_context', {
    student,
    record: record({ path: 'assessment.txt', quote: '2026-05-30 at 18:00' }),
  });
  await service.confirmPlanningContext(proposed.id, ['Use Mondays.']);
  assert.ok((await service.draftPlan({ weeks: 1 })).id);
  assert.deepEqual(calls.filter(([url]) => url === '/__calendarpit/fixtures'), [['/__calendarpit/fixtures', fixture]]);
  assert.ok(calls.some(([url]) => url === `/__calendarpit/calendars/${student}-calendar/events`));
});

test('staged-only reads, preparation, preview and drafting fail on missing workspaces even for dev IDs', async t => {
  const root = await tempDir(t);
  const calendar = { events: async () => [] };
  const source = path.join(root, 'source');
  await mkdir(source);
  await withSyntheticRuntime(root, async () => {
    assert.ok((await listWorkspace('ana')).some(entry => entry.name === 'courses.json'));
    await assert.rejects(() => listWorkspace('ana', '', { requireStaged: true }), /workspace is unavailable/);
    await assert.rejects(() => readWorkspace('ana', 'courses.json', { requireStaged: true }), /workspace is unavailable/);
    await assert.rejects(() => initializeScenario(calendar, 'ana', { requireStaged: true }), /Explicit workspace and calendar fixture/);
    await initializeScenario(calendar, 'ana', { ...staged, coldStart: true, workspaceSource: source, expectedEvents: [] });
    await rm(path.join(root, 'workspaces', 'ana'), { recursive: true });
    await assert.rejects(() => previewPlan(calendar, 'ana', { record: record() }, staged), /workspace is unavailable/);
    await assert.rejects(() => draft(calendar, 'ana', {}, staged), /workspace is unavailable/);
    await assert.rejects(() => proposePlanningContext('ana', record(), staged), /workspace is unavailable/);
    await withSyntheticRuntime(root, async () => {
      await assert.rejects(() => readWorkspace('ana', 'courses.json', { requireStaged: false }), /workspace is unavailable/);
      await assert.rejects(() => draft(calendar, 'ana'), /workspace is unavailable/);
      await assert.rejects(() => new Calendarpit().reset('ana'), /Explicit synthetic calendar fixture/);
    }, staged);
  });
});

test('Poppler inspects and extracts addressed pages with file, page and range bounds', async t => {
  const root = await tempDir(t);
  const workspace = path.join(root, 'workspaces', student);
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, pdfPath), pdf(501));
  await writeFile(path.join(workspace, 'small.pdf'), pdf(2));
  await symlink(path.join(root, 'outside.pdf'), path.join(workspace, 'linked.pdf'));
  await writeFile(path.join(root, 'outside.pdf'), pdf(1));
  await withSyntheticRuntime(root, async () => {
    const info = await inspectPdf(student, pdfPath, staged);
    assert.equal(info.pageCount, 501);
    assert.equal(info.pagesIndex.length, 500);
    assert.equal(info.pagesIndex.at(-1), 500);
    const result = await readWorkspacePageRange(student, pdfPath, { ...staged, pageStart: 2, pageEnd: 4 });
    assert.deepEqual([result.path, result.pageStart, result.pageEnd, result.totalPages], [pdfPath, 2, 4, 501]);
    assert.deepEqual(result.pages.map(({ page, text }) => [page, text.trim()]), [[2, quote(2)], [3, ''], [4, quote(4)]]);
    const last = await readWorkspacePageRange(student, pdfPath, { ...staged, pageStart: 500, pageEnd: 500 });
    assert.equal(last.pages[0].text.trim(), quote(500));
    assert.match(await readWorkspace(student, 'small.pdf', staged), /instructions on page 2/);
    for (const range of [
      { pageStart: 1, pageEnd: 4 }, { pageStart: 1, pageEnd: 4, maxPages: 4 },
      { pageStart: 500, pageEnd: 501 }, { pageStart: 0, pageEnd: 1 }, { pageStart: 3, pageEnd: 2 }, { pageStart: 1 },
    ]) {
      await assert.rejects(() => readWorkspacePageRange(student, pdfPath, { ...staged, ...range }), /at most three pages/);
    }
    await assert.rejects(() => readWorkspacePageRange(student, 'small.pdf', { ...staged, pageStart: 3, pageEnd: 3 }), /document page count/);
    await assert.rejects(() => inspectPdf(student, 'linked.pdf', staged), /outside synthetic workspace/);
    await truncate(path.join(workspace, pdfPath), 2_000_001);
    await assert.rejects(() => inspectPdf(student, pdfPath, staged), /PDF file too large/);
    await assert.rejects(() => readWorkspacePageRange(student, pdfPath, { ...staged, pageStart: 1, pageEnd: 1 }), /PDF file too large/);
  });
});

test('Eval v2 preview and proposal cite only the per-arm text actually disclosed by preload or tools', async t => {
  const root = await tempDir(t);
  const source = path.join(root, 'source');
  await mkdir(source);
  await writeFile(path.join(source, pdfPath), pdf(4));
  const calendar = { events: async () => [] };
  await withSyntheticRuntime(root, async () => {
    await initializeScenario(calendar, student, { workspaceSource: source, coldStart: 'sealed-42', expectedEvents: [] });
  }, staged);
  const disclosedSources = createDisclosedSources();
  disclosedSources.disclose(pdfPath, quote(1), 1);
  const serviceOptions = { ...staged, student, calendar, clock, schemaProfile: 'eval-v2', coldStart: true, runtimeDirectory: root };
  const service = createTrustedStudyService({ ...serviceOptions, disclosedSources });
  const call = (method, args) => service.agent.call(method, { student, ...args });
  const propose = value => call('propose_planning_context', { record: value });
  assert.ok((await call('preview_plan', { weeks: 1, record: record({ path: pdfPath, page: 1, quote: quote(1) }) })).ok);
  await assert.rejects(() => propose(record()), /not disclosed/);
  await assert.rejects(() => call('preview_plan', { record: record() }), /not disclosed/);
  assert.equal((await call('read_synthetic_file', { path: pdfPath, pageStart: 2, pageEnd: 2 })).pages[0].text.trim(), quote(2));
  assert.ok((await propose(record())).id);
  await assert.rejects(() => propose(record({ path: pdfPath, page: 4, quote: quote(4) })), /not disclosed/);
  await assert.rejects(() => propose(record({ path: pdfPath, page: 2, quote: quote(4) })), /Cited quote was not found/);
  const otherArm = createTrustedStudyService(serviceOptions);
  await assert.rejects(() => otherArm.agent.call('propose_planning_context', { student, record: record() }), /not disclosed/);
  const disk = () => assert.fail('Eval v2 citation validation must not read disk');
  await assert.rejects(() => validatePlanningContext(record(), disk, clock.date, { schemaProfile: 'eval-v2' }), /requires disclosed/);
  const page500 = record({ path: pdfPath, page: 500, quote: quote(500) });
  disclosedSources.disclose(pdfPath, quote(500), 500);
  assert.deepEqual(await validatePlanningContext(page500, disk, clock.date, { disclosedSources }), page500);
});

test('neutral schemas and prompt are selectable for both standard and Gemini tools', () => {
  const methods = ['propose_planning_context', 'preview_plan', 'read_synthetic_file'];
  const prompt = { student, clock, locale: 'en' };
  const devHints = /optional clinics|November (?:2|15), 2026/i;
  assert.match(JSON.stringify(buildOpenAITools(methods)), devHints);
  assert.match(buildSystemPrompt(prompt), devHints);
  for (const schemaCompat of ['standard', 'gemini']) {
    const tools = buildOpenAITools(methods, { schemaCompat, schemaProfile: 'eval-v2' });
    assert.doesNotMatch(JSON.stringify(tools), devHints);
    const read = tools.find(tool => tool.function.name === 'read_synthetic_file').function.parameters;
    assert.deepEqual(read.required, ['path']);
    assert.equal(read.properties.pageEnd.maximum, 500);
    if (schemaCompat === 'gemini') assert.doesNotMatch(JSON.stringify(tools), /additionalProperties/);
  }
  assert.doesNotMatch(buildSystemPrompt({ ...prompt, schemaProfile: 'eval-v2' }), devHints);
});

test('transport requires fixed peers and exact paths, with loopback as the default', async t => {
  const fixed = 'http://calendarpit:4173';
  const originOptions = { origin: fixed, accessToken: 'synthetic' };
  assert.throws(() => new Calendarpit(fixed), /loopback/);
  assert.throws(() => new CalendarpitApi(originOptions), /localhost/);
  assert.throws(() => createHttpRunnerAdapter({ url: 'http://runner:4180' }), /loopback/);
  assert.throws(() => createOpenAICompatibleCompleter({ baseUrl: 'http://evaluator:4181/v1' }), /loopback/);
  const completeChat = async () => ({ choices: [] });
  await assert.rejects(() => startSingleAgentServer({ host: '0.0.0.0', port: 4180, completeChat }), /bind to loopback/);
  await assert.rejects(() => startSingleAgentServer({ host: '0.0.0.0', port: 4181, transport, completeChat }), /bind to loopback/);
  for (const mode of ['loopback', transport]) {
    for (const invalid of ['http://anything.test:4173', 'http://calendarpit:4174', 'http://user@calendarpit:4173', 'http://user@127.0.0.1:4173', fixed + '/bad']) {
      assert.throws(() => new Calendarpit(invalid, { transport: mode }), /loopback/);
      assert.throws(() => new CalendarpitApi({ ...originOptions, origin: invalid, transport: mode }), /localhost/);
    }
    for (const invalid of ['https://runner:4180', 'http://runner:4181', 'http://host.test:4180', 'http://user@runner:4180', 'http://runner:4180/sessions']) {
      assert.throws(() => createHttpRunnerAdapter({ url: invalid, transport: mode }), /loopback/);
    }
    const server = await startSingleAgentServer({ transport: mode, completeChat });
    t.after(() => server.close());
    for (const [url, expected] of [
      ['http://evaluator:4181/tools/call', mode === transport ? 200 : 400],
      ['http://evaluator:4182/tools/call', 400],
      ['http://evaluator:4181/v1/chat/completions', 400],
      ['http://user@evaluator:4181/tools/call', 400],
      ['http://tools.example:4181/tools/call', 400],
    ]) {
      assert.equal((await post(server.url + '/sessions', { student, clock, toolBridge: { url, token: 'test' } })).status, expected);
    }
  }

  const requested = [];
  const fetchImpl = async (url, options) => {
    requested.push([url, options.redirect]);
    return Response.json({ items: [] });
  };
  await new Calendarpit(fixed, { transport, fetchImpl, allowedStudents }).events(student);
  await new CalendarpitApi({ ...originOptions, transport, fetchImpl }).listEvents('synthetic-calendar');
  assert.deepEqual(requested, [
    [fixed + `/__calendarpit/calendars/${student}-calendar/events`, 'error'],
    [fixed + '/calendar/v3/calendars/synthetic-calendar/events', 'error'],
  ]);
  const bridgeCalls = [];
  const adapter = createHttpRunnerAdapter({
    url: 'http://runner:4180', transport,
    mountToolBridge: handler => { assert.equal(typeof handler, 'function'); return () => {}; },
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'error');
      bridgeCalls.push(url);
      if (options.body) {
        const body = JSON.parse(options.body);
        assert.equal(body.toolBridge.url, 'http://evaluator:4181/tools/call');
        assert.equal(body.sources, undefined);
      }
      return Response.json({ sessionId: 'fake-session' });
    },
  });
  const session = await adapter.createSession({ bundle: { manifest: { student, clock, sources: ['hidden'] } }, service: { agent: {} } });
  await session.close();
  assert.deepEqual(bridgeCalls, ['http://runner:4180/sessions', 'http://runner:4180/sessions/fake-session']);
});

test('both transport modes reject HTTP redirects instead of forwarding requests or credentials', async t => {
  let escaped = 0;
  const target = await listen(t, createServer((req, res) => { escaped++; json(res, {}); }));
  const redirector = await listen(t, createServer((req, res) => {
    res.writeHead(307, { location: target });
    res.end();
  }));
  for (const mode of ['loopback', transport]) {
    await assert.rejects(() => new Calendarpit(redirector, { transport: mode }).events('ana'), /fetch failed/);
    await assert.rejects(() => new CalendarpitApi({ origin: redirector, accessToken: 'test', transport: mode }).listEvents('ana-calendar'), /fetch failed/);
    const adapter = createHttpRunnerAdapter({ url: redirector, transport: mode, ...(mode === transport ? { mountToolBridge: () => () => {} } : {}) });
    await assert.rejects(() => adapter.createSession({ bundle: { manifest: { student, clock } }, service: { agent: {} } }), /fetch failed/);
    const complete = createOpenAICompatibleCompleter({ baseUrl: redirector + '/v1', apiKey: 'test', transport: mode });
    await assert.rejects(() => complete({ model: 'stub', messages: [{ role: 'user', content: 'Hello' }] }), /fetch failed/);
  }
  assert.equal(escaped, 0);
});

test('synthetic OAuth permits a dynamic user only with the trusted allowlist and transport', async () => {
  const run = { origin: 'http://calendarpit:4173', client: { id: 'local-client', secret: 'test-secret', redirectUris: [callback] } };
  let state;
  const requests = [];
  const fetchImpl = async (target, options) => {
    const url = new URL(target);
    requests.push([url.origin, url.pathname, options.redirect]);
    if (!options.method) {
      state = url.searchParams.get('state');
      return new Response('<input name="consent" value="synthetic-nonce">');
    }
    if (url.pathname === '/oauth/authorize') {
      assert.equal(options.body.get('user_id'), 'ravi');
      return Response.redirect(`${callback}?state=${state}&code=code`);
    }
    return Response.json({ access_token: 'synthetic-calendar-token' });
  };
  await assert.rejects(() => authorizeSyntheticCalendar({ run, student: 'ravi', redirectUri: callback, allowedStudents, fetchImpl }), /loopback/);
  await assert.rejects(() => authorizeSyntheticCalendar({ run, student: 'ravi', redirectUri: callback, transport, fetchImpl }), /Unknown synthetic student/);
  await assert.rejects(() => authorizeSyntheticCalendar({ run, student: 'ravi', redirectUri: run.origin + '/callback', transport, allowedStudents, fetchImpl }), /loopback/);
  assert.equal(await authorizeSyntheticCalendar({ run, student: 'ravi', redirectUri: callback, allowedStudents, transport, fetchImpl }), 'synthetic-calendar-token');
  assert.deepEqual(requests, [
    [run.origin, '/oauth/authorize', 'error'], [run.origin, '/oauth/authorize', 'manual'], [run.origin, '/oauth/token', 'error'],
  ]);
  await assert.rejects(() => authorizeSyntheticCalendar({
    run, student: 'ravi', redirectUri: callback, allowedStudents, transport,
    fetchImpl: async (url, options) => !options.method ? fetchImpl(url, options) : Response.redirect('http://other.test/callback'),
  }), /does not match/);
});

const chatModel = 'openai/test-arm';
const geminiModel = 'gemini/test-arm';
const operatorModel = 'mistralai/mistral-small-2603';
const judgeModel = 'mistralai/mistral-large-4-0';
const jev = 'jev-1.14.0';
const liquid = 'liquid/d1.2-ultra';
const chat = '/v1/chat/completions';
const gemini = '/v1/gemini/chat/completions';
const systemone = '/v1/systemone';
const pricing = { inputPerMillion: 1, outputPerMillion: 2, verifiedAt: new Date().toISOString() };
const decisions = [{ type: 'noul' }, { type: 'choice', options: ['yes', 'no'] }, { type: 'score' }];
const apiKeys = { OPENROUTER_API_KEY: 'stub-or', GEMINI_API_KEY: 'stub-g', TYPESAFE_API_KEY: 'stub-ts' };
const policies = {
  [chatModel]: { pricing, providerOnly: ['arm-provider'] },
  [geminiModel]: { pricing },
  [operatorModel]: { pricing, providerOnly: ['operator-provider'], supportsTemperature: true },
  [judgeModel]: { pricing, providerOnly: ['judge-provider'] },
  [jev]: { pricing: { ...pricing, outputPerMillion: 0 } },
  [liquid]: { pricing: { ...pricing, outputPerMillion: 0 } },
};
const messages = [{ role: 'user', content: 'Synthetic evaluation question.' }];

async function gatewayFixture(t, { roleAModel = chatModel, roleAProvider, targetUsd = 0.25, usage, redirect } = {}) {
  const requests = [];
  const forwarded = [];
  const stub = await listen(t, createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests.push({ authorization: req.headers.authorization, body });
    if (redirect) {
      res.writeHead(307, { location: redirect });
      return res.end();
    }
    const report = usage ? usage(body) : [jev, liquid].includes(body.model)
      ? { input_tokens: 200, ...(body.model === liquid ? { cost: 0.0003 } : {}) }
      : { prompt_tokens: 100, completion_tokens: 50, ...(body.model === geminiModel ? {} : { cost: 0.0003 }) };
    json(res, { choices: [], usage: report });
  }));
  const budget = await createModelBudget({ directory: await tempDir(t), targetUsd });
  t.after(() => budget.close());
  const gateway = createEvalGateway({
    roleAModel, roleAProvider, modelPolicies: policies, apiKeys, budget,
    fetchImpl: (url, options) => {
      forwarded.push(url);
      assert.equal(options.redirect, 'error');
      return fetch(stub, options);
    },
  });
  const base = await listen(t, gateway.server);
  const call = (route, token, body, role = 'judge') => post(base + route, body, {
    authorization: `Bearer ${token}`, 'x-study-role': role,
  });
  return { ...gateway, call, budget, requests, forwarded };
}

test('gateway binds model and route to each token and enforces separate OpenRouter model policies', async t => {
  const gateway = await gatewayFixture(t);
  const { runnerToken, operatorToken, judgeToken, call, requests, forwarded, budget } = gateway;
  assert.equal(new Set([runnerToken, operatorToken, judgeToken]).size, 3);
  assert.equal((await call(chat, 'wrong', { model: chatModel, messages })).status, 401);
  for (const [route, token, model] of [
    [chat, runnerToken, operatorModel], [chat, runnerToken, judgeModel], [systemone, runnerToken, jev],
    [systemone, runnerToken, chatModel], [chat, operatorToken, chatModel], [systemone, operatorToken, liquid],
    [chat, judgeToken, operatorModel], [gemini, runnerToken, chatModel], [chat, judgeToken, jev],
  ]) assert.equal((await call(route, token, { model, messages, questions: decisions })).status, 403);
  assert.equal((await call(chat, runnerToken, { model: chatModel, models: [judgeModel], messages })).status, 400);
  assert.equal(requests.length, 0);
  for (const [token, model, provider] of [[runnerToken, chatModel, 'arm-provider'], [operatorToken, operatorModel, 'operator-provider'], [judgeToken, judgeModel, 'judge-provider']]) {
    const response = await call(chat, token, { model, messages, temperature: 0, provider: { only: ['spoofed'] } }, 'setup');
    assert.equal(response.status, 200);
    const { body, authorization } = requests.at(-1);
    assert.equal(authorization, 'Bearer stub-or');
    assert.equal(body.model, model);
    assert.deepEqual(body.provider, { only: [provider], require_parameters: true, allow_fallbacks: false });
    assert.equal(body.temperature, model === operatorModel ? 0 : undefined);
    assert.equal((await response.json()).usage.cost_source, 'provider');
  }
  assert.deepEqual(forwarded, Array(3).fill('https://openrouter.ai/api/v1/chat/completions'));
  for (const role of ['agent', 'operator', 'judge']) {
    assert.deepEqual(await budget.summary({ role }), {
      observedUsd: 0.0003, pendingCount: 0, unknownCount: 0, inputTokens: 100, outputTokens: 50,
    });
  }
  gateway.retire();
  assert.equal((await call(chat, runnerToken, { model: chatModel, messages })).status, 401);
  assert.equal((await call(chat, operatorToken, { model: operatorModel, messages })).status, 401);
  assert.equal((await call(chat, judgeToken, { model: judgeModel, messages })).status, 401);
});

test('Gemini uses the AI Studio endpoint and permits low reasoning effort', async t => {
  const gateway = await gatewayFixture(t, { roleAModel: geminiModel, roleAProvider: 'gemini' });
  const body = { model: geminiModel, messages, reasoning_effort: 'low' };
  assert.equal((await gateway.call(chat, gateway.runnerToken, body)).status, 403);
  assert.equal((await gateway.call(gemini, gateway.runnerToken, { ...body, reasoning_effort: 'high' })).status, 400);
  const response = await gateway.call(gemini, gateway.runnerToken, body);
  assert.equal(response.status, 200);
  const { usage } = await response.json();
  assert.equal(usage.cost, 0.0002);
  assert.equal(usage.cost_source, 'token-rates');
  assert.deepEqual(gateway.forwarded, ['https://generativelanguage.googleapis.com/v1beta/openai/chat/completions']);
  assert.equal(gateway.requests[0].authorization, 'Bearer stub-g');
  assert.equal(gateway.requests[0].body.reasoning_effort, 'low');
  assert.equal(gateway.requests[0].body.provider, undefined);
});

test('System One routes both decision models for the judge and accounts for zero output tokens', async t => {
  const gateway = await gatewayFixture(t);
  assert.equal((await gateway.call(systemone, gateway.judgeToken, { model: jev, questions: [{ type: 'other' }] })).status, 400);
  for (const [model, credential, cost] of [[jev, 'stub-ts', 0.0002], [liquid, 'stub-or', 0.0003]]) {
    const response = await gateway.call(systemone, gateway.judgeToken, { model, context: 'Synthetic text', questions: decisions });
    assert.equal(response.status, 200);
    const { usage } = await response.json();
    assert.equal(usage.input_tokens, 200);
    assert.equal(usage.output_tokens, 0);
    assert.equal(usage.cost, cost);
    assert.equal(gateway.requests.at(-1).authorization, `Bearer ${credential}`);
    assert.deepEqual(gateway.requests.at(-1).body.questions, decisions);
  }
  assert.deepEqual(gateway.forwarded, ['https://api.typesafe.ai/v1/systemone', 'https://openrouter.ai/api/v1/systemone']);
  const { inputTokens, outputTokens } = await gateway.budget.summary({ role: 'judge' });
  assert.deepEqual([inputTokens, outputTokens], [400, 0]);
});

test('eval gateway blocks over-budget requests and keeps unreported OpenRouter spend unknown', async t => {
  const tooSmall = await gatewayFixture(t, { targetUsd: 0.001 });
  assert.equal((await tooSmall.call(chat, tooSmall.runnerToken, { model: chatModel, messages })).status, 409);
  assert.equal(tooSmall.requests.length, 0);

  const gateway = await gatewayFixture(t, { usage: () => ({ prompt_tokens: 100, completion_tokens: 50 }) });
  const response = await gateway.call(chat, gateway.runnerToken, { model: chatModel, messages });
  assert.equal(response.status, 200);
  const { usage } = await response.json();
  assert.equal(usage.cost, null);
  assert.equal(usage.cost_source, 'unknown');
  assert.equal((await gateway.call(chat, gateway.operatorToken, { model: operatorModel, messages })).status, 409);
  assert.equal(gateway.requests.length, 1);
  assert.deepEqual(await gateway.budget.summary({ role: 'agent' }), {
    observedUsd: null, pendingCount: 0, unknownCount: 1, inputTokens: 100, outputTokens: 50,
  });
  assert.deepEqual([formatUsd(null), formatUsd('unknown'), formatUsd(0)], ['unknown', 'unknown', '$0.0000']);
  const summary = formatSummaryMarkdown({
    generatedAt: clock.date, scenario: 'stub', rows: [{ model: chatModel, caseId: 'dev', passed: true, observedUsd: null }],
  });
  assert.match(summary, /Total observed OpenRouter spend:\*\* `unknown`/);
  assert.doesNotMatch(summary, /\$0\.0000/);
});

test('gateway never follows an upstream redirect and fences the unresolved reservation', async t => {
  let reached = false;
  const redirect = await listen(t, createServer((req, res) => { reached = true; json(res, {}); }));
  const gateway = await gatewayFixture(t, { redirect });
  const request = () => gateway.call(chat, gateway.runnerToken, { model: chatModel, messages });
  assert.equal((await request()).status, 502);
  assert.equal((await request()).status, 409);
  assert.equal(reached, false);
  assert.equal((await gateway.budget.summary({ role: 'agent' })).unknownCount, 1);
  assert.equal((await gateway.budget.summary()).observedUsd, null);
  assert.equal((await gateway.budget.summary()).totalUsd, null);
});

test('sol-loop R1 regressions: narrowed allowlists, bounded eval-v2 PDFs, trace-atomic disclosure, non-empty normalized quotes, explicit eval clock, and providerOnly validation', async t => {
  const root = await tempDir(t);
  const source = path.join(root, 'source');
  await mkdir(source);
  await writeFile(path.join(source, pdfPath), pdf(4));
  const calendar = { events: async () => [] };
  await withSyntheticRuntime(root, async () => {
    await initializeScenario(calendar, student, { workspaceSource: source, coldStart: 'sealed-42', expectedEvents: [] });
  }, staged);

  // 1. Allowlist intersection: nested/per-call/Calendarpit allowlists can only narrow access.
  await withSyntheticRuntime(root, async () => {
    assert.throws(() => assertStudent('bruno', ['bruno']), /Unknown fixture/);
    await withSyntheticRuntime(root, async () => {
      assert.throws(() => assertStudent('bruno'), /Unknown fixture/);
    }, { allowedStudents: ['bruno'] });
    const cal = new Calendarpit('http://127.0.0.1:4173', { allowedStudents: ['ana', 'bruno'], fetchImpl: async () => Response.json({ items: [] }) });
    await assert.rejects(() => cal.events('bruno', { allowedStudents: ['bruno'] }), /Unknown fixture/);
    assert.equal(assertStudent('ana', ['ana', 'bruno']), 'ana');
  }, { allowedStudents: ['ana'] });

  // 2. Eval v2 rejects omitted/invalid clock (including impossible calendar dates like 2026-02-30).
  assert.throws(() => createTrustedStudyService({ ...staged, student, calendar, schemaProfile: 'eval-v2', coldStart: true, runtimeDirectory: root }), /explicit valid clock/);
  assert.throws(() => createTrustedStudyService({ ...staged, student, calendar, clock: { date: 'bad', timezone: 'UTC' }, schemaProfile: 'eval-v2', coldStart: true, runtimeDirectory: root }), /explicit valid clock/);
  assert.throws(() => createTrustedStudyService({ ...staged, student, calendar, clock: { date: '2026-02-30', timezone: 'UTC' }, schemaProfile: 'eval-v2', coldStart: true, runtimeDirectory: root }), /explicit valid clock/);
  assert.throws(() => createTrustedStudyService({ ...staged, student, calendar, clock: { date: '2026-05-01', timezone: 'Not/A_Zone' }, schemaProfile: 'eval-v2', coldStart: true, runtimeDirectory: root }), /explicit valid clock/);

  // 3. Eval v2 rejects unbounded full-PDF reads (including via symlink to a PDF) while v1 preserves them.
  const disclosedSources = createDisclosedSources();
  await symlink(path.join(root, 'workspaces', student, pdfPath), path.join(root, 'workspaces', student, 'alias.txt'));
  const evalService = createTrustedStudyService({
    ...staged, student, calendar, clock, schemaProfile: 'eval-v2', coldStart: true, runtimeDirectory: root, disclosedSources,
  });
  await assert.rejects(() => evalService.agent.call('read_synthetic_file', { student, path: pdfPath }), /bounded pageStart and pageEnd/);
  await assert.rejects(() => evalService.agent.call('read_synthetic_file', { student, path: 'alias.txt' }), /bounded pageStart and pageEnd/);
  const v1Service = createTrustedStudyService({
    ...staged, student, calendar, clock, schemaProfile: 'v1', coldStart: true, runtimeDirectory: root,
  });
  assert.match(await v1Service.agent.call('read_synthetic_file', { student, path: pdfPath }), /instructions on page 4/);

  // 4. Failed completion trace write must NOT mark the page disclosed.
  const traceDisclosed = createDisclosedSources();
  let traceCalls = 0;
  const failingTrace = {
    async append(kind, payload) {
      traceCalls++;
      if (kind === 'tool' && payload.phase === 'completed') throw new Error('disk full');
    },
  };
  const tracedService = createTrustedStudyService({
    ...staged, student, calendar, clock, schemaProfile: 'eval-v2', coldStart: true, runtimeDirectory: root,
    disclosedSources: traceDisclosed, trace: failingTrace,
  });
  await assert.rejects(() => tracedService.agent.call('read_synthetic_file', { student, path: pdfPath, pageStart: 2, pageEnd: 2 }), /Evidence recording failed/);
  assert.ok(traceCalls >= 2);
  assert.deepEqual(traceDisclosed.read(pdfPath, 2), []);

  // 5. Empty normalized quote (only markdown markers) rejected even on a disclosed blank page.
  disclosedSources.disclose(pdfPath, '', 3);
  await assert.rejects(
    () => validatePlanningContext(record({ path: pdfPath, page: 3, quote: '********' }), () => assert.fail('no disk'), clock.date, { disclosedSources, schemaProfile: 'eval-v2' }),
    /empty after normalization/,
  );

  // 6. Eval gateway rejects providerOnly pins on non-OpenRouter-chat models (e.g., System One) and supports object-map questions + state.
  const budget = await createModelBudget({ directory: await tempDir(t), targetUsd: 0.25 });
  t.after(() => budget.close());
  assert.throws(() => createEvalGateway({
    roleAModel: chatModel,
    modelPolicies: { ...policies, [liquid]: { pricing: { ...pricing, outputPerMillion: 0 }, providerOnly: ['liquid'] } },
    apiKeys, budget,
  }), /providerOnly pin is only supported for OpenRouter chat models/);
  const gateway = await gatewayFixture(t);
  const mapRes = await gateway.call(systemone, gateway.judgeToken, {
    model: jev,
    state: { transcript: 'Synthetic turn' },
    questions: { safe: { type: 'noul', instructions: 'Was it safe?' } },
  });
  assert.equal(mapRes.status, 200);
  assert.deepEqual(gateway.requests.at(-1).body.state, { transcript: 'Synthetic turn' });
  assert.equal(gateway.requests.at(-1).body.questions.safe.type, 'noul');
});
