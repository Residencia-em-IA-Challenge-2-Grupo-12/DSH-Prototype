import { readFile, realpath } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { Calendarpit, ROOT } from '../src/core.mjs';
import { buildDevCaseBundle, loadCaseBundle } from '../src/eval-v2/case-schema.mjs';
import { JUDGE_MODELS } from '../src/eval-v2/judge-b2.mjs';
import { buildMatrix, runMatrix } from '../src/eval-v2/orchestrator.mjs';
import { createOperatorCache, OPERATOR_MODEL } from '../src/eval-v2/operator-b1.mjs';
import { buildReport } from '../src/eval-v2/report.mjs';
import { createEvalGateway } from '../src/foundation/eval-gateway.mjs';
import { EVAL_CALENDAR_ORIGIN, EVAL_EVALUATOR_ORIGIN, EVAL_RUNNER_ORIGIN } from '../src/foundation/eval-transport.mjs';
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
});
const configSchema = z.strictObject({
  stage: z.enum(['dev', 'sealed']), models: z.array(pin),
  bundleDirs: z.array(name).optional(), repoPath: name.optional(), peerRepoPath: name.optional(),
  gitLogFile: name.optional(), tieBreakCaseId: name.optional(),
  transport: z.enum(['loopback', 'compose-eval']).default('loopback'),
  judgeModels: z.array(z.enum(JUDGE_MODELS)).optional(),
  policies: z.record(name, policy).optional(),
  operatorProviderPin: name.optional(), operatorCacheDir: name.optional(),
  budgetDirectory: name.optional(), budgetUsd: z.number().positive().max(5).default(5),
});

async function readInput(filename) {
  const resolved = await realpath(filename);
  if ([filename, resolved].some(file => /^(?:\.env(?:\.|$)|\.envrc$)/i.test(basename(file)))) {
    throw new Error('Invalid input file');
  }
  return readFile(resolved, 'utf8');
}

async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string' }, 'matrix-only': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    process.stdout.write(`Usage: node scripts/eval-v2.mjs --config FILE [--matrix-only]

Config JSON requires stage (dev or sealed) and models [{model, provider, route}].
Use five models for dev and one frozen model for sealed. Route is openrouter or gemini.
The dev stage defaults to the checked-in dev fixtures. Sealed requires five external bundleDirs.
Each bundle contains a case.json with the inline calendarFixture and a workspace directory.
See src/eval-v2/case-schema.mjs for the complete case contract.
To execute, supply budgetDirectory, operatorProviderPin and current per-model policies.
Set transport to compose-eval to use the isolated single-agent runner and Calendarpit.
Compose reads the host checkout from /repo and mounts sealed case bundles under /sealed-eval.
Results, blinded grading packets, and the evaluator-only join map are written to stdout.
--matrix-only prints the schedule without starting a gateway or contacting a model.
`);
    return;
  }
  if (!values.config) throw new Error('Pass --config FILE or --help');
  const config = configSchema.parse(JSON.parse(await readInput(values.config)));
  const compose = config.transport === 'compose-eval';
  const repoPath = config.repoPath ?? (compose ? '/repo' : ROOT);
  if (config.stage === 'sealed' && !config.bundleDirs) throw new Error('Sealed evaluation requires external bundle directories');
  const bundles = await Promise.all(config.bundleDirs
    ? config.bundleDirs.map(directory => loadCaseBundle(directory, { split: config.stage, repoRoot: repoPath }))
    : ['bruno', 'ana-held-out'].map(caseId => buildDevCaseBundle(caseId, { repoRoot: repoPath })));
  const cells = buildMatrix({ ...config, bundles });
  if (values['matrix-only']) {
    console.log(JSON.stringify(cells.map(({ bundle, ...cell }) => ({ ...cell, caseId: bundle.caseId })), null, 2));
    return;
  }
  if (!config.budgetDirectory || !config.policies || !config.operatorProviderPin) {
    throw new Error('Execution requires budgetDirectory, current model policies, and operatorProviderPin');
  }
  const { policies, operatorProviderPin, transport } = config;
  const matchesProvider = (model, provider) => {
    const providerOnly = policies[model]?.providerOnly;
    return providerOnly?.length === 1 && providerOnly[0] === provider;
  };
  if (config.models.some(model => model.route === 'openrouter' && !matchesProvider(model.model, model.provider)) ||
      !matchesProvider(OPERATOR_MODEL, operatorProviderPin) ||
      config.models.some(model => model.route === 'gemini' && model.provider !== 'gemini')) {
    throw new Error('Configured gateway policies must pin the declared providers');
  }
  // The isolated runner uses one configured model/route at a time. Keep dev
  // screening evaluator-local; the sealed sweep uses the frozen Compose runner.
  if (compose && config.stage === 'dev') throw new Error('Run the multi-model dev stage with loopback transport');
  // Both pinned Mistral routes use the preregistered deterministic sampling.
  for (const model of [OPERATOR_MODEL, JUDGE_MODELS[2]]) {
    if (policies[model]) policies[model].supportsTemperature = true;
  }
  const gitLogText = config.gitLogFile && await readInput(config.gitLogFile);
  const budget = await createModelBudget({ directory: resolve(config.budgetDirectory), targetUsd: config.budgetUsd });
  const blindedPackets = [];
  try {
    const { runs, scan, joinMap } = await runMatrix({ ...config, repoPath, gitLogText, bundles,
      operatorCache: createOperatorCache({ directory: config.operatorCacheDir }),
      ...(compose ? {
        runnerUrl: EVAL_RUNNER_ORIGIN,
        async calendars(fixture, cell) {
          const student = cell.bundle.student;
          const calendar = new Calendarpit(EVAL_CALENDAR_ORIGIN, { transport, allowedStudents: [student], fixture });
          await calendar.reset(student);
          return calendar;
        },
      } : {}),
      onBlindedPacket: packet => { blindedPackets.push(packet); },
      async openGateway(model) {
        const gateway = createEvalGateway({ roleAModel: model.model, roleAProvider: model.route, modelPolicies: policies, budget });
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
      },
    });
    const report = buildReport({ stage: config.stage, runs, tieBreakCaseId: config.tieBreakCaseId });
    console.log(JSON.stringify({ scan, report, runs, blindedPackets, evaluatorJoinMap: Object.fromEntries(joinMap) }, null, 2));
    if (!scan.clean) process.exitCode = 1;
  } finally {
    await budget.close();
  }
}

main().catch(error => {
  // Configuration can name sealed data. Only print schema field paths here.
  console.error(error instanceof z.ZodError
    ? 'Invalid configuration or case fields: ' + error.issues.map(issue => issue.path.join('.')).join(', ')
    : 'Eval v2 failed: ' + (error.code ?? (error.message?.startsWith('Pass --') ? error.message : 'check configuration and local services')));
  process.exitCode = 1;
});
