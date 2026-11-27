import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { ROOT } from '../src/core.mjs';
import { buildDevCaseBundle, loadCaseBundle } from '../src/eval-v2/case-schema.mjs';
import { openClaimedEvalCalendar, runComposeSweep } from '../src/eval-v2/compose-sweep.mjs';
import { JUDGE_MODELS } from '../src/eval-v2/judge-b2.mjs';
import { buildMatrix, prepareMatrix, runCase, runMatrix } from '../src/eval-v2/orchestrator.mjs';
import { createOperatorCache, OPERATOR_MODEL } from '../src/eval-v2/operator-b1.mjs';
import { buildReport, verifyStage1Decision } from '../src/eval-v2/report.mjs';
import { createEvalGateway } from '../src/foundation/eval-gateway.mjs';
import { EVAL_EVALUATOR_ORIGIN, EVAL_RUNNER_ORIGIN } from '../src/foundation/eval-transport.mjs';
import { createModelBudget } from '../src/foundation/model-budget.mjs';

const name = z.string().trim().min(1);
const route = z.enum(['openrouter', 'gemini']);
const pricing = z.strictObject({
  inputPerMillion: z.number().nonnegative(), outputPerMillion: z.number().nonnegative(),
  verifiedAt: z.iso.datetime(), freeTier: z.boolean().optional(),
});
const policy = z.strictObject({
  pricing, providerOnly: z.array(name).min(1).optional(), requireParameters: z.boolean().optional(),
  supportsTemperature: z.boolean().optional(),
});
const pin = z.strictObject({
  model: name, provider: name, route, schemaCompat: z.enum(['standard', 'gemini']).optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  modelAliases: z.array(name).max(20).optional(),
});
const configSchema = z.strictObject({
  stage: z.enum(['dev', 'sealed']), models: z.array(pin),
  bundleDirs: z.array(name).optional(), repoPath: name.optional(), peerRepoPath: name.optional(), peerRepoRoot: name.optional(),
  gitLogFile: name.optional(), tieBreakerCase: name.optional(),
  transport: z.enum(['loopback', 'compose-eval']).default('loopback'),
  judgeModels: z.array(z.enum(JUDGE_MODELS)).optional(),
  policies: z.record(name, policy).optional(),
  operatorProviderPin: name.optional(), operatorCacheDir: name.optional(),
  budgetDirectory: name.optional(), budgetUsd: z.number().positive().max(5).default(5),
});

const reject = (code, message) => { throw Object.assign(new Error(message), { code }); };

async function readInput(filename) {
  const resolved = await realpath(filename);
  if ([filename, resolved].some(file => /^(?:\.env(?:\.|$)|\.envrc$)/i.test(basename(file)))) {
    throw new Error('Invalid input file');
  }
  return readFile(resolved, 'utf8');
}

async function readCellInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw new Error('Invalid isolated cell envelope');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function inside(root, file) {
  const rel = relative(root, file);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}

function validateExecution(config) {
  if (config.stage === 'sealed' && config.transport !== 'compose-eval') {
    reject('sealed_requires_compose', 'Sealed execution requires Compose isolation');
  }
  if (config.stage === 'dev' && config.transport === 'compose-eval') {
    reject('dev_requires_loopback', 'The multi-model dev stage uses loopback transport');
  }
  if (config.stage === 'sealed' && !config.peerRepoRoot) {
    reject('peer_repo_root_required', 'Sealed execution requires peerRepoRoot for the checkout and Git history scan');
  }
  if (config.stage === 'dev' && !config.tieBreakerCase) {
    reject('tie_breaker_required', 'Freeze a third dev bundle before screening');
  }
  const { policies, operatorProviderPin, budgetDirectory } = config;
  if (!budgetDirectory || !policies || !operatorProviderPin) {
    reject('execution_configuration_required', 'Execution requires a budget, model policies, and an operator provider pin');
  }
  const matchesProvider = (model, provider) => {
    const providerOnly = policies[model]?.providerOnly;
    return providerOnly?.length === 1 && providerOnly[0] === provider;
  };
  const judges = config.judgeModels ?? JUDGE_MODELS;
  if (new Set(judges).size !== judges.length ||
      config.models.some(model => model.route === 'openrouter' && !matchesProvider(model.model, model.provider)) ||
      config.models.some(model => model.route === 'gemini' && model.provider !== 'gemini') ||
      !matchesProvider(OPERATOR_MODEL, operatorProviderPin) ||
      (judges.includes(JUDGE_MODELS[2]) && policies[JUDGE_MODELS[2]]?.providerOnly?.length !== 1)) {
    reject('provider_pin_required', 'Configured gateway policies must pin the declared providers');
  }
  for (const model of [OPERATOR_MODEL, JUDGE_MODELS[2]]) {
    if (policies[model]) policies[model].supportsTemperature = true;
  }
}

async function openGateway(model, config, budget) {
  const compose = config.transport === 'compose-eval';
  const gateway = createEvalGateway({ roleAModel: model.model, roleAProvider: model.route, modelPolicies: config.policies, budget });
  try {
    await new Promise((done, reject) => {
      gateway.server.once('error', reject);
      gateway.server.listen(compose ? 4181 : 0, compose ? '0.0.0.0' : '127.0.0.1', done);
    });
  } catch (error) {
    gateway.retire();
    throw error;
  }
  const origin = compose ? EVAL_EVALUATOR_ORIGIN : `http://127.0.0.1:${gateway.server.address().port}`;
  return { ...gateway, origin, chatBaseUrl: origin + (model.route === 'gemini' ? '/v1/gemini' : '/v1'),
    reasoningEffort: model.reasoningEffort,
    async close() {
      gateway.retire();
      await new Promise((done, reject) => gateway.server.close(error => error ? reject(error) : done()));
    } };
}

function composeCommand({ project, env }) {
  return (args, input) => new Promise((done, reject) => {
    const child = execFile('docker', ['compose', '--env-file', '/dev/null', '-f', 'compose.eval.yaml',
      '-p', project, ...args], { cwd: ROOT, env, timeout: 600_000, maxBuffer: 24 * 1024 * 1024 },
    (error, stdout) => error ? reject(Object.assign(new Error('Compose command failed'), { code: 'compose_command_failed' })) : done(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function executeHostSweep({ config, bundles, repoPath, project, decision }) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) reject('compose_project_invalid', 'Expected a Compose project name');
  const prepared = await prepareMatrix({ ...config, bundles, repoPath, peerRepoPath: config.peerRepoRoot });
  if (!prepared.scan.clean) return { scan: prepared.scan, runs: [], blindedPackets: [], evaluatorJoinMap: {} };
  const sealedRoot = await realpath(process.env.STUDY_SEALED_EVAL_DIR);
  const bundleDirs = await Promise.all(config.bundleDirs.map(async directory => {
    const file = await realpath(directory);
    if (!inside(sealedRoot, file)) reject('bundle_mount_invalid', 'Expected bundles under the configured sealed mount');
    return resolve('/sealed-eval', relative(sealedRoot, file));
  }));
  for (const directory of [config.budgetDirectory, config.operatorCacheDir].filter(Boolean)) {
    if (!isAbsolute(directory) || !inside('/tmp', resolve(directory))) {
      reject('compose_state_directory_invalid', 'Compose budget and operator cache must be under evaluator /tmp');
    }
  }
  const frozen = config.models[0];
  const env = { ...process.env, STUDY_SEALED_EVAL_DIR: sealedRoot, STUDY_EVAL_REPO_DIR: repoPath,
    STUDY_EVAL_ROLE_A_MODEL: frozen.model, STUDY_EVAL_SCHEMA_COMPAT: frozen.schemaCompat ?? 'standard',
    STUDY_EVAL_REASONING_EFFORT: frozen.reasoningEffort ?? '',
    STUDY_EVAL_GATEWAY_BASE_URL: EVAL_EVALUATOR_ORIGIN + (frozen.route === 'gemini' ? '/v1/gemini' : '/v1'),
  };
  const compose = composeCommand({ project, env });
  const runnerHealthScript = `
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(${JSON.stringify(EVAL_RUNNER_ORIGIN + '/health')}, { signal: AbortSignal.timeout(1000) });
        if (response.ok) process.exit(0);
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    process.exit(1);
  `;
  let sweepError;
  try {
    await compose(['up', '-d', '--build', 'evaluator', 'runner']);
    await compose(['exec', '-T', 'evaluator', 'node', '--input-type=module', '-e', runnerHealthScript]);
    const { startComposeCalendarpitRun } = await import('../src/foundation/calendarpit-runner.mjs');
    const redirectUri = 'http://127.0.0.1:4175/callback';
    const evaluatorConfig = { ...config, bundleDirs, repoPath: '/repo' };
    const outputs = await runComposeSweep({
      cells: prepared.cells, project, redirectUri,
      startCalendar: options => startComposeCalendarpitRun({ ...options, runDocker: async (...args) => {
        if (args[0] === 'compose') {
          const commandIndex = args.indexOf('run', 7);
          if (commandIndex < 0) throw new Error('Unexpected Compose lifecycle command');
          return (await compose(args.slice(commandIndex))).trim();
        }
        return new Promise((done, reject) => execFile('docker', args, { cwd: ROOT, env, timeout: 30_000 },
          (error, stdout) => error ? reject(new Error('Calendarpit lifecycle command failed')) : done(stdout.trim())));
      } }),
      async executeCell({ cell, index, run }) {
        const envelope = { config: evaluatorConfig, decision, run, redirectUri, expectedPreload: prepared.hashes.get(cell.bundle.caseId) };
        const output = await compose(['exec', '-T', 'evaluator', 'node', 'scripts/eval-v2.mjs', '--config', '-', '--cell', String(index)],
          JSON.stringify(envelope));
        return JSON.parse(output);
      },
    });
    return { scan: prepared.scan, runs: outputs.map(item => item.run), blindedPackets: outputs.flatMap(item => item.blindedPackets),
      evaluatorJoinMap: Object.assign({}, ...outputs.map(item => item.evaluatorJoinMap)) };
  } catch (error) {
    sweepError = error;
    throw error;
  } finally {
    try {
      await compose(['down', '--remove-orphans']);
    } catch (downError) {
      if (!sweepError) throw downError;
    }
  }
}

async function executeCell({ config, cell, envelope, budget }) {
  const { run, redirectUri, expectedPreload } = envelope;
  if (!/^[a-f0-9]{64}$/.test(expectedPreload) || !run?.id) reject('cell_handoff_invalid', 'Expected a preflighted host cell');
  const { calendar, perturbCalendar } = await openClaimedEvalCalendar({ run, redirectUri, student: cell.bundle.student });
  const gateway = await openGateway(cell.pin, config, budget);
  const joinMap = new Map();
  const blindedPackets = [];
  try {
    const row = await runCase({ cell, gateway, expectedPreload, transport: config.transport, runnerUrl: EVAL_RUNNER_ORIGIN,
      calendars: () => calendar, perturbCalendar, judgeModels: config.judgeModels ?? JUDGE_MODELS,
      operatorProviderPin: config.operatorProviderPin,
      operatorCache: createOperatorCache({ directory: config.operatorCacheDir ?? resolve(config.budgetDirectory, 'operator-cache') }),
      joinMap, onBlindedPacket: packet => { blindedPackets.push(packet); } });
    return { run: row, blindedPackets, evaluatorJoinMap: Object.fromEntries(joinMap) };
  } finally {
    await gateway.close();
  }
}

async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string' }, 'matrix-only': { type: 'boolean' },
    'stage1-decision': { type: 'string' }, 'host-compose': { type: 'string' }, cell: { type: 'string' },
    help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    process.stdout.write(`Usage: node scripts/eval-v2.mjs --config FILE [--matrix-only]
       node scripts/eval-v2.mjs --config FILE --host-compose PROJECT --stage1-decision FILE

Dev execution takes five pinned models, two cases, and a preselected tieBreakerCase directory.
Save the dev output for --stage1-decision. Sealed requires one verified finalist,
five external bundleDirs, transport compose-eval, and peerRepoRoot for history scanning.
Set STUDY_SEALED_EVAL_DIR to the host directory containing the bundles.
Compose execution uses a dedicated project and evaluator /tmp paths for budget and cache.
The host starts and retires one Calendarpit per cell. --cell is the internal evaluator entrypoint.
--matrix-only prints the base schedule without starting a gateway or contacting a model.
`);
    return;
  }
  if (!values.config) throw new Error('Pass --config FILE or --help');
  const single = values.cell !== undefined;
  if (single && (values.config !== '-' || values['host-compose'] || values['matrix-only'])) {
    reject('cell_handoff_invalid', 'The evaluator cell accepts a host envelope on stdin');
  }
  const envelope = single ? await readCellInput() : null;
  const config = configSchema.parse(envelope?.config ?? JSON.parse(await readInput(values.config)));
  const host = values['host-compose'];
  if (!values['matrix-only']) validateExecution(config);
  if (host && config.stage !== 'sealed') reject('compose_stage_invalid', 'The Compose sweep is for sealed execution');
  if (!values['matrix-only'] && config.stage === 'sealed' && !single && !host) {
    reject('host_compose_required', 'Start sealed execution with --host-compose');
  }
  const decision = envelope?.decision ?? (values['stage1-decision'] && JSON.parse(await readInput(values['stage1-decision'])));
  if (!values['matrix-only'] && config.stage === 'sealed') verifyStage1Decision(decision?.stage1Decision ?? decision, config.models[0]);
  const repoPath = await realpath(config.repoPath ?? (single ? '/repo' : ROOT));
  if (host && repoPath !== await realpath(ROOT)) {
    reject('repo_root_mismatch', 'Scan the same checkout used to build the sealed evaluator and runner');
  }
  if (config.stage === 'sealed' && !config.bundleDirs) throw new Error('Sealed evaluation requires external bundle directories');
  const bundles = await Promise.all(config.bundleDirs
    ? config.bundleDirs.map(directory => loadCaseBundle(directory, { split: config.stage, repoRoot: repoPath }))
    : ['bruno', 'ana-held-out'].map(caseId => buildDevCaseBundle(caseId, { repoRoot: repoPath })));
  const cells = buildMatrix({ ...config, bundles });
  if (values['matrix-only']) {
    console.log(JSON.stringify(cells.map(({ bundle, ...cell }) => ({ ...cell, caseId: bundle.caseId })), null, 2));
    return;
  }
  if (host) {
    const output = await executeHostSweep({ config, bundles, repoPath, project: host, decision: decision.stage1Decision ?? decision });
    console.log(JSON.stringify({ ...output, report: buildReport({ stage: 'sealed', runs: output.runs }) }, null, 2));
    if (!output.scan.clean) process.exitCode = 1;
    return;
  }
  if (single && (config.stage !== 'sealed' || !/^\d+$/.test(values.cell) || !cells[Number(values.cell)] ||
      repoPath !== '/repo' || bundles.some(bundle => !inside('/sealed-eval', bundle.workspaceDir)))) {
    reject('cell_handoff_invalid', 'Expected a sealed cell in the isolated evaluator mounts');
  }
  const budget = await createModelBudget({ directory: resolve(config.budgetDirectory), targetUsd: config.budgetUsd });
  try {
    if (single) {
      console.log(JSON.stringify(await executeCell({ config, cell: cells[Number(values.cell)], envelope, budget })));
      return;
    }
    const tieBreakerCase = config.tieBreakerCase && await loadCaseBundle(config.tieBreakerCase, { split: 'dev', repoRoot: repoPath });
    const gitLogText = config.gitLogFile && await readInput(config.gitLogFile);
    const blindedPackets = [];
    const { runs, scan, joinMap, stage1Decision } = await runMatrix({ ...config, repoPath, gitLogText, bundles, tieBreakerCase,
      peerRepoPath: config.peerRepoRoot ?? config.peerRepoPath,
      operatorCache: createOperatorCache({ directory: config.operatorCacheDir }),
      onBlindedPacket: packet => { blindedPackets.push(packet); },
      openGateway: model => openGateway(model, config, budget),
    });
    const report = buildReport({ stage: config.stage, runs, tieBreakCaseId: tieBreakerCase?.caseId });
    console.log(JSON.stringify({ scan, report, runs, stage1Decision, blindedPackets, evaluatorJoinMap: Object.fromEntries(joinMap) }, null, 2));
    if (!scan.clean) process.exitCode = 1;
  } finally {
    await budget.close();
  }
}

main().catch(error => {
  console.error(error instanceof z.ZodError
    ? 'Invalid configuration or case fields: ' + error.issues.map(issue => issue.path.join('.')).join(', ')
    : 'Eval v2 failed: ' + (error.code ?? (error.message?.startsWith('Pass --') ? error.message : 'check configuration and local services')));
  process.exitCode = 1;
});
