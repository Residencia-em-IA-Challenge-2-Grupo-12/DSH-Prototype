import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ROOT } from '../src/core.mjs';
import { createModelBudget, formatUsd } from '../src/foundation/model-budget.mjs';
import { createOpenRouterGateway } from '../src/foundation/openrouter-gateway.mjs';
import { packBundle, readBundle } from '../src/paired-replay/bundle.mjs';
import { createHttpRunnerAdapter } from '../src/paired-replay/http-adapter.mjs';
import { runPortableReplay, scenarios } from '../src/paired-replay/runner.mjs';
import { createOpenAICompatibleCompleter, startSingleAgentServer } from '../src/runners/single-agent/server.mjs';

const exec = promisify(execFile);

export const DEFAULT_MODELS = [
  'openai/gpt-6-luna',
  'deepseek/deepseek-v4.1-flash-1017',
  'meta/muse-ember',
];
export const DEFAULT_CASES = ['bruno', 'ana-held-out'];

export function parseCompareArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${key}`);
    flags[key.slice(2)] = argv[++i];
  }
  const models = (flags.models ? flags.models.split(',') : DEFAULT_MODELS).map(s => s.trim()).filter(Boolean);
  const cases = (flags.cases ? flags.cases.split(',') : DEFAULT_CASES).map(s => s.trim()).filter(Boolean);
  const scenario = flags.scenario || 'success';
  const budgetUsd = Number(flags['budget-usd'] ?? 0.25);
  const maxSteps = Number(flags['max-steps'] ?? 24);
  const outDir = flags['out-dir'];
  const reasoningEffort = flags['reasoning-effort'] || undefined;
  const providerOnly = flags['provider-only'] && flags['provider-only'] !== 'none'
    ? flags['provider-only'].split(',').map(s => s.trim()).filter(Boolean)
    : null;

  if (!outDir) {
    throw new Error(
      'Usage: compare-live-models.mjs --out-dir <dir> [--models m1,m2] [--cases bruno,ana-held-out] [--scenario success] [--budget-usd 0.25] [--max-steps 24] [--reasoning-effort low] [--provider-only none|provider]',
    );
  }
  if (!models.length) throw new Error('At least one model is required');
  if (!cases.length) throw new Error('At least one case is required');
  if (!scenarios.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 5) {
    throw new Error('budget-usd must be between 0 and 5');
  }
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 64) {
    throw new Error('max-steps must be an integer between 1 and 64');
  }
  return { models, cases, scenario, budgetUsd, maxSteps, outDir: path.resolve(outDir), reasoningEffort, providerOnly };
}

export function extractCatalogPricing(catalog, modelId, verifiedAt = new Date().toISOString()) {
  const entries = Array.isArray(catalog?.data) ? catalog.data : [];
  const match = entries.find(item => item?.id === modelId);
  if (!match?.pricing) throw new Error(`Model pricing not found in OpenRouter catalog: ${modelId}`);
  const prompt = Number(match.pricing.prompt);
  const completion = Number(match.pricing.completion);
  if (!Number.isFinite(prompt) || prompt <= 0 || !Number.isFinite(completion) || completion <= 0) {
    throw new Error(`Invalid OpenRouter catalog pricing for ${modelId}`);
  }
  return {
    inputPerMillion: Number((prompt * 1_000_000).toPrecision(6)),
    outputPerMillion: Number((completion * 1_000_000).toPrecision(6)),
    verifiedAt,
  };
}

export function formatSummaryMarkdown({ generatedAt, scenario, rows }) {
  const totalUsd = rows.every(row => Number.isFinite(row.observedUsd) && row.observedUsd >= 0)
    ? rows.reduce((sum, row) => sum + row.observedUsd, 0)
    : null;
  const lines = [
    `# Live Single-Agent Model Baseline (${generatedAt.slice(0, 10)})`,
    '',
    `- **Scenario:** \`${scenario}\` (real Docker Calendarpit + local SQLite budgeted OpenRouter gateway + independent Python probe)`,
    `- **Total observed OpenRouter spend:** \`${formatUsd(totalUsd)}\` across ${rows.length} run(s)`,
    '',
    '| Model | Case | Overall | Probe | Duration | Steps / Tools | Tool Errs | Questions (Turns) | Input / Output Tokens | Observed USD | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const status = row.passed ? 'PASS' : 'FAIL';
    const probe = row.probeOk ? 'PASS' : 'FAIL';
    const secs = `${(row.durationMs / 1000).toFixed(1)}s`;
    const tokens = row.usage?.availability === 'available'
      ? `${row.usage.inputTokens.toLocaleString('en-US')} / ${row.usage.outputTokens.toLocaleString('en-US')}`
      : 'unknown';
    const cost = formatUsd(row.observedUsd);
    const notes = row.passed
      ? 'All replay checks passed; retirement verified'
      : [...row.failedCheckDetails.map(c => `${c.id}: ${c.detail}`), ...row.failureMessages]
          .filter(Boolean)
          .slice(0, 2)
          .join('; ');
    lines.push(
      `| \`${row.model}\` | \`${row.caseId}\` | **${status}** | ${probe} | ${secs} | ${row.llmSteps} / ${row.toolCallCount} | ${row.toolErrorCount} | ${row.questionsAsked} (${row.questionTurns}) | ${tokens} | ${cost} | ${notes.replace(/\|/g, '\\|')} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function loadOpenRouterApiKey() {
  if (process.env.OPENROUTER_API_KEY?.trim()) return process.env.OPENROUTER_API_KEY.trim();
  const envPath = path.join(ROOT, '.env');
  const text = await readFile(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'OPENROUTER_API_KEY' && val) return val;
  }
  throw new Error('OPENROUTER_API_KEY is required in the environment or .env');
}

async function fetchOpenRouterCatalog() {
  const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Failed to fetch OpenRouter model catalog (${response.status})`);
  return response.json();
}

async function main() {
  const opts = parseCompareArgs(process.argv.slice(2));
  const apiKey = await loadOpenRouterApiKey();
  const verifiedAt = new Date().toISOString();
  const catalog = await fetchOpenRouterCatalog();
  const pricingByModel = new Map(opts.models.map(model => [model, extractCatalogPricing(catalog, model, verifiedAt)]));

  await mkdir(opts.outDir, { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), 'study-live-compare-'));
  const rows = [];

  try {
    const bundles = {};
    for (const caseId of opts.cases) {
      const dir = path.join(work, `bundle-${caseId}`);
      await packBundle(caseId, dir);
      bundles[caseId] = { dir, bundle: await readBundle(dir) };
    }

    for (const model of opts.models) {
      const pricing = pricingByModel.get(model);
      for (const caseId of opts.cases) {
        const slug = `${model.replace(/[^a-z0-9]+/gi, '-')}__${caseId}`;
        const budgetDir = path.join(work, `budget-${slug}`);
        await mkdir(budgetDir, { recursive: true });
        const budget = await createModelBudget({ directory: budgetDir, targetUsd: opts.budgetUsd });
        const accessToken = randomBytes(24).toString('hex');
        const gateway = createOpenRouterGateway({
          apiKey,
          accessToken,
          budget,
          pricing,
          policy: { allowedModels: [model], providerOnly: opts.providerOnly },
        });
        await new Promise((resolve, reject) => gateway.once('error', reject).listen(0, '127.0.0.1', resolve));
        const gatewayUrl = `http://127.0.0.1:${gateway.address().port}/v1`;

        const trace = [];
        const runnerServer = await startSingleAgentServer({
          completeChat: createOpenAICompatibleCompleter({
            baseUrl: gatewayUrl,
            apiKey: accessToken,
            reasoningEffort: opts.reasoningEffort,
            timeoutMs: 120_000,
          }),
          model,
          mode: 'live',
          maxSteps: opts.maxSteps,
          onEvent: ev => trace.push(ev),
        });

        const resultFilename = `${slug}.result.json`;
        const resultPath = path.join(opts.outDir, resultFilename);
        let runOutcome;
        try {
          runOutcome = await runPortableReplay(bundles[caseId].bundle, opts.scenario, {
            adapter: createHttpRunnerAdapter({
              url: runnerServer.url,
              engine: { name: `Single-agent HTTP (${model})`, mode: 'live', model },
              timeoutMs: 300_000,
            }),
            saveResult: async evidence => {
              await writeFile(resultPath, JSON.stringify(evidence, null, 2) + '\n');
            },
          });
        } finally {
          await runnerServer.close();
          await new Promise(resolve => gateway.close(() => resolve()));
        }

        const budgetSummary = await budget.summary();
        await budget.close();

        let probeOk = false;
        let probeOutput = '';
        try {
          const probe = await exec('python3', [
            path.join(ROOT, 'scripts/paired-replay-probe.py'),
            '--check-result',
            bundles[caseId].dir,
            resultPath,
          ]);
          probeOk = true;
          probeOutput = probe.stdout.trim();
        } catch (err) {
          probeOutput = (err.stderr || err.stdout || err.message || '').trim().slice(0, 400);
        }

        const { result, failures } = runOutcome;
        const failedChecks = result.checks.filter(c => c.outcome !== 'pass');
        const llmSteps = trace.filter(e => e.type === 'llm_step');
        const toolCalls = trace.filter(e => e.type === 'tool');
        const toolErrors = toolCalls.filter(e => e.isError);
        const questions = result.timeline.filter(e => e.kind === 'question');
        const questionTurns = llmSteps.filter(s => s.toolCalls.includes('ask_user_question')).length;

        const row = {
          model,
          caseId,
          scenario: opts.scenario,
          pricing,
          passed: failures.length === 0 && failedChecks.length === 0 && result.retirement === 'verified' && probeOk,
          retirement: result.retirement,
          probeOk,
          probeOutput,
          durationMs: result.durationMs,
          llmSteps: llmSteps.length,
          toolCallCount: toolCalls.length,
          toolErrorCount: toolErrors.length,
          toolErrors: toolErrors.map(e => ({ name: e.name, error: String(e.error || '').slice(0, 200) })),
          questionsAsked: questions.length,
          questionTurns,
          usage: result.usage,
          observedUsd: budgetSummary.pendingCount || budgetSummary.unknownCount ? null : budgetSummary.observedUsd,
          checks: Object.fromEntries(result.checks.map(c => [c.id, c.outcome])),
          failedCheckDetails: failedChecks,
          failureMessages: failures.map(f => f.message),
          resultFile: resultFilename,
        };
        rows.push(row);
        console.log(JSON.stringify({
          slug,
          passed: row.passed,
          probeOk: row.probeOk,
          durationMs: row.durationMs,
          llmSteps: row.llmSteps,
          toolCallCount: row.toolCallCount,
          toolErrorCount: row.toolErrorCount,
          questionsAsked: row.questionsAsked,
          questionTurns: row.questionTurns,
          usage: row.usage,
          observedUsd: row.observedUsd,
          failedChecks: failedChecks.map(c => `${c.id}: ${c.detail}`),
          failures: row.failureMessages,
        }));
      }
    }

    const generatedAt = new Date().toISOString();
    const summaryPayload = { generatedAt, scenario: opts.scenario, budgetPerRunUsd: opts.budgetUsd, rows };
    await writeFile(path.join(opts.outDir, 'summary.json'), JSON.stringify(summaryPayload, null, 2) + '\n');
    await writeFile(path.join(opts.outDir, 'README.md'), formatSummaryMarkdown(summaryPayload));
    console.log(JSON.stringify({ done: true, summary: path.join(opts.outDir, 'summary.json') }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
