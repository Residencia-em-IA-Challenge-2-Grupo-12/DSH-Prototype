// EVAL_DOCKER_TEST=1 ./node_modules/.bin/node --test tests/eval-compose-topology.integration.mjs
// Uses temporary synthetic seeds and a loopback stub. The pinned Calendarpit
// image must already be available to Docker.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { promisify } from 'node:util';
import { startComposeCalendarpitRun } from '../src/foundation/calendarpit-runner.mjs';
import { runComposeSweep } from '../src/eval-v2/compose-sweep.mjs';

const exec = promisify(execFile);
const student = 'ravi';
const redirectUri = 'http://127.0.0.1:4175/callback';

function seed(version) {
  return {
    users: [{ id: student, name: 'Ravi', email: 'ravi@eval.test' }],
    calendars: [{ id: 'ravi-calendar', userId: student, summary: 'Eval calendar', timeZone: 'America/Sao_Paulo', primary: true }],
    events: [{
      id: `seed-${version}`, calendarId: 'ravi-calendar', summary: `Seed ${version}`,
      start: { dateTime: '2026-05-01T12:00:00-03:00', timeZone: 'America/Sao_Paulo' },
      end: { dateTime: '2026-05-01T13:00:00-03:00', timeZone: 'America/Sao_Paulo' },
    }],
  };
}

const evaluatorProbe = String.raw`
  import assert from 'node:assert/strict';
  import { once } from 'node:events';
  import { randomUUID } from 'node:crypto';
  import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
  import { createServer } from 'node:http';
  import { CalendarpitApi } from './src/foundation/calendarpit-api.mjs';
  import { authorizeSyntheticCalendar } from './src/foundation/synthetic-calendar-auth.mjs';
  import { createEvalGateway } from './src/foundation/eval-gateway.mjs';
  import { createModelBudget } from './src/foundation/model-budget.mjs';
  import { createHttpRunnerAdapter } from './src/paired-replay/http-adapter.mjs';
  import { openClaimedEvalCalendar } from './src/eval-v2/compose-sweep.mjs';
  import { runCase } from './src/eval-v2/orchestrator.mjs';

  const [run, student, redirectUri, version, calendarFixture] = JSON.parse(process.argv[1]);
  const transport = 'compose-eval';
  const authFile = '/tmp/calendar-token-from-first-seed';
  const token = await authorizeSyntheticCalendar({ run, student, redirectUri, transport, allowedStudents: [student] });
  const calendarWithToken = accessToken => new CalendarpitApi({ origin: run.origin, accessToken, transport });
  const observed = await calendarWithToken(token).listEvents('ravi-calendar');
  assert.deepEqual(observed.items.map(event => event.id), ['seed-' + version]);
  assert.equal(await readFile('/sealed-eval/marker.txt', 'utf8'), 'synthetic marker');
  await assert.rejects(() => writeFile('/sealed-eval/marker.txt', 'unexpected'));
  if (version === 'first') {
    await writeFile(authFile, token, { mode: 0o600 });
  } else {
    const stale = await readFile(authFile, 'utf8');
    await assert.rejects(() => calendarWithToken(stale).listEvents('ravi-calendar'), error => [401, 403].includes(error.status));
  }

  const stub = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    const hasToolResult = body.messages.at(-1)?.role === 'tool';
    const v2 = body.messages[0]?.content.includes('Finish each turn with one JSON action');
    if (v2) assert.match(body.messages[0].content, /study-preload-v1/);
    const message = hasToolResult
      ? { role: 'assistant', content: v2 ? '{"action":"answer","message":"Verified through Eval v2."}' : 'Verified through the tool bridge.' }
      : { role: 'assistant', content: '', tool_calls: [
        { id: 'local-only', type: 'function', function: { name: 'list_calendar', arguments: '{}' } },
      ] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 2, completion_tokens: 1, cost: 0.00001 } }));
  });
  stub.listen(0, '127.0.0.1');
  await once(stub, 'listening');
  const stubUrl = 'http://127.0.0.1:' + stub.address().port;
  const budget = await createModelBudget({ directory: '/tmp/budget-' + version, targetUsd: 0.1 });
  const model = 'openai/topology-test';
  const modelPolicies = { [model]: { pricing: { inputPerMillion: 1, outputPerMillion: 1, verifiedAt: new Date().toISOString() } } };
  const options = {
    roleAModel: model, budget, modelPolicies, apiKeys: { OPENROUTER_API_KEY: 'local-stub' },
    fetchImpl: (url, init) => fetch(stubUrl, init),
  };
  const gateway = createEvalGateway(options);
  gateway.server.listen(4181, '0.0.0.0');
  await once(gateway.server, 'listening');
  let toolCalls = 0;
  const service = { agent: { allowedMethods: () => ['list_calendar'], call: (method, args) => {
    assert.equal(method, 'list_calendar');
    assert.equal(args.student, student);
    toolCalls++;
    return { events: observed.items.map(event => event.id) };
  } } };
  const adapter = createHttpRunnerAdapter({
    url: 'http://runner:4180', transport, runnerToken: gateway.runnerToken, mountToolBridge: gateway.mountToolBridge,
  });
  const manifest = { student, clock: { date: '2026-05-01', timezone: 'America/Sao_Paulo' } };
  const session = await adapter.createSession({ bundle: { manifest }, service, runId: run.id });
  try {
    const snapshot = await session.prompt('What is on the synthetic calendar?');
    assert.match(snapshot.messages.at(-1).text, /Verified through the tool bridge/);
    assert.equal(toolCalls, 1);
    await session.close();
    const workspaceDir = await mkdtemp('/tmp/topology-workspace-');
    try {
      const { calendar } = await openClaimedEvalCalendar({ run, redirectUri, student });
      const bundle = { ...manifest, caseId: 'topology-fixture', archetype: 'compound_mixed_intent', locale: 'en',
        split: 'dev', canaryGuid: randomUUID(), initialRequest: 'What is on the synthetic calendar?', calendarFixture,
        workspaceDir, workspaceFiles: [], preloadConfig: { maxPdfPages: 2, maxTextChars: 100 },
        oracle: { requiredDeadlines: [], forbiddenInjectionPatterns: [] },
        operatorFacts: { disclosable: {}, forbiddenSecrets: [], hiddenOracleFacts: [] } };
      const row = await runCase({ cell: { bundle, arm: 'C3', repeat: 1, pin: { model, provider: 'stub' } },
        gateway: { ...gateway, origin: 'http://evaluator:4181' }, operatorProviderPin: 'stub',
        runnerUrl: 'http://runner:4180', transport, calendars: () => calendar });
      assert.equal(row.failure, null, JSON.stringify(row));
      assert.equal(row.exchanges[0].action.message, 'Verified through Eval v2.');
      assert.equal(row.serverTurns[0].toolAttempts, 1);
      assert.equal(row.serverTurns[0].completions, 2);
      assert.equal(row.gates.budget_compliance.passed, true);
      assert.equal(row.spendUsd, 0.00002);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  } finally {
    await session.close();
    gateway.retire();
    await new Promise(resolve => gateway.server.close(resolve));
  }
  const replacement = createEvalGateway(options);
  replacement.server.listen(4181, '0.0.0.0');
  await once(replacement.server, 'listening');
  try {
    const response = await fetch('http://evaluator:4181/v1/chat/completions', {
      method: 'POST', headers: { authorization: 'Bearer ' + gateway.runnerToken },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Old token' }] }),
    });
    assert.equal(response.status, 401);
  } finally {
    replacement.retire();
    await new Promise(resolve => replacement.server.close(resolve));
    await new Promise(resolve => stub.close(resolve));
    await budget.close();
  }
`;

const runnerProbe = String.raw`
  import assert from 'node:assert/strict';
  import { existsSync, readFileSync } from 'node:fs';
  const [calendarIp] = process.argv.slice(1);
  assert.equal(existsSync('/sealed-eval'), false);
  assert.equal(existsSync('/repo'), false);
  assert.equal(existsSync('/app/src/eval-v2'), false);
  assert.equal(existsSync('/app/src/foundation/eval-gateway.mjs'), false);
  assert.equal(existsSync('/app/src/domain/planner.mjs'), false);
  assert.equal(existsSync('/var/run/docker.sock'), false);
  assert.equal(process.env.OPENROUTER_API_KEY, undefined);
  assert.equal(process.env.GEMINI_API_KEY, undefined);
  assert.equal(process.env.TYPESAFE_API_KEY, undefined);
  assert.equal(process.env.STUDY_RUNNER_API_KEY, undefined);
  assert(!readFileSync('/proc/net/route', 'utf8').split('\n').some(line => line.trim().split(/\s+/)[1] === '00000000'));
  for (const host of ['calendarpit', calendarIp]) {
    await assert.rejects(() => fetch('http://' + host + ':4173/__calendarpit/health', { signal: AbortSignal.timeout(1000) }));
  }
`;

test('Compose seed switch, token retirement and runner network isolation', { skip: process.env.EVAL_DOCKER_TEST !== '1', timeout: 240_000 }, async () => {
  const directory = await mkdtemp(`${tmpdir()}/study-eval-topology-`);
  const project = `study-eval-topology-${randomUUID().slice(0, 8)}`;
  const env = { ...process.env, STUDY_SEALED_EVAL_DIR: directory, STUDY_EVAL_ROLE_A_MODEL: 'openai/topology-test',
    STUDY_EVAL_GATEWAY_BASE_URL: 'http://evaluator:4181/v1', STUDY_EVAL_SCHEMA_COMPAT: 'standard',
    STUDY_EVAL_REASONING_EFFORT: '' };
  for (const key of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'TYPESAFE_API_KEY']) delete env[key];
  const docker = async (...args) => (await exec('docker', args, { env, timeout: 150_000, maxBuffer: 1024 * 1024 })).stdout.trim();
  const compose = (...args) => docker('compose', '--env-file', '/dev/null', '-f', 'compose.eval.yaml', '-p', project, ...args);
  const runEvalProbe = async (run, version, fixture) => {
    try {
      await compose('exec', '-T', 'evaluator', 'node', '--input-type=module', '-e', evaluatorProbe,
        JSON.stringify([run, student, redirectUri, version, fixture]));
    } catch (error) {
      throw new Error(`Evaluator probe failed for the ${version} synthetic seed\n${error.stderr || ''}`);
    }
  };
  try {
    await writeFile(`${directory}/marker.txt`, 'synthetic marker');
    await compose('up', '-d', '--build', 'evaluator', 'runner');
    for (const [network, internal, expected] of [
      ['net_calendar', true, ['evaluator']], ['net_eval', true, ['evaluator', 'runner']], ['net_egress', false, ['evaluator']],
    ]) {
      const info = JSON.parse(await docker('network', 'inspect', '--format', '{{json .}}', `${project}_${network}`));
      assert.equal(info.Internal, internal);
      assert.deepEqual(Object.values(info.Containers).map(container => container.Name).sort(), expected.map(service => `${project}-${service}-1`));
    }
    for (const service of ['evaluator', 'runner']) {
      const options = JSON.parse(await docker('inspect', '--format', '{{json .HostConfig}}', await compose('ps', '-q', service)));
      assert.equal(options.ReadonlyRootfs, true);
      assert.deepEqual(options.CapDrop, ['ALL']);
      assert.ok(options.SecurityOpt.some(value => value.startsWith('no-new-privileges')));
      assert.deepEqual(Object.keys(options.PortBindings ?? {}), []);
      assert.deepEqual(Object.keys(options.Tmpfs), ['/tmp']);
    }
    const cells = ['first', 'second'].map(version => ({ version, bundle: { calendarFixture: seed(version) } }));
    const containerIds = [];
    const result = await runComposeSweep({ project, redirectUri, cells,
      startCalendar: options => startComposeCalendarpitRun({ ...options, runDocker: docker }),
      async executeCell({ cell, run }) {
        const net = JSON.parse(await docker('network', 'inspect', '--format', '{{json .}}', `${project}_net_calendar`));
        const entry = Object.entries(net.Containers).find(([, container]) => container.Name.startsWith('study-eval-calendar-'));
        assert.ok(entry);
        const [id, calendar] = entry;
        containerIds.push(id);
        const inspected = JSON.parse(await docker('inspect', '--format', '{{json .}}', calendar.Name));
        assert.deepEqual(Object.keys(inspected.HostConfig.PortBindings ?? {}), []);
        assert.deepEqual(inspected.Mounts.filter(mount => mount.Type === 'bind').map(mount => [mount.Destination, mount.RW]), [['/fixtures/startup.json', false]]);
        assert.equal(inspected.Mounts.some(mount => mount.Type === 'volume'), false);
        assert.deepEqual(Object.keys(inspected.HostConfig.Tmpfs), ['/data']);
        await compose('exec', '-T', 'runner', 'node', '--input-type=module', '-e', runnerProbe, calendar.IPv4Address.split('/')[0]);
        await runEvalProbe(run, cell.version, cell.bundle.calendarFixture);
        return run.id;
      },
    });
    assert.equal(new Set(result).size, 2);
    assert.equal(new Set(containerIds).size, 2);
    for (const id of containerIds) await assert.rejects(docker('inspect', id));
  } finally {
    try { await compose('down', '--remove-orphans'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
});
