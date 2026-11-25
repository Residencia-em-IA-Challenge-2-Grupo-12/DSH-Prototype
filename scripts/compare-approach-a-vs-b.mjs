import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ROOT } from '../src/core.mjs';
import { createModelBudget } from '../src/foundation/model-budget.mjs';
import { createOpenRouterGateway } from '../src/foundation/openrouter-gateway.mjs';
import { packBundle, readBundle } from '../src/paired-replay/bundle.mjs';
import { createHttpRunnerAdapter } from '../src/paired-replay/http-adapter.mjs';
import { runPortableReplay, scenarios as ALL_SCENARIOS } from '../src/paired-replay/runner.mjs';
import { extractCatalogPricing } from './compare-live-models.mjs';

const exec = promisify(execFile);

const DEFAULT_PIPELINES = ['a1', 'a2'];
const DEFAULT_MODELS = ['openai/gpt-6-luna', 'meta/muse-ember'];
const DEFAULT_CASES = ['bruno', 'ana-held-out'];
const DEFAULT_SCENARIOS = ['success', 'stale'];
const DEFAULT_BASELINE = path.join(ROOT, 'docs/evidence/live-single-agent-baseline-2026-11-24/summary.json');
const FALLBACK_MAIN_ENV = '/home/david/Projects/Residência de IA/Challenge 2/DSH-Prototype/.env';

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${key}`);
    flags[key.slice(2)] = argv[++i];
  }
  const outDir = flags['out-dir'];
  if (!outDir) {
    throw new Error(
      'Usage: compare-approach-a-vs-b.mjs --out-dir <dir> [--pipelines a1,a2] [--models m1,m2] [--cases bruno,ana-held-out] [--scenarios success,stale] [--budget-usd 0.25] [--reasoning-effort low] [--provider-only none|provider]',
    );
  }
  const pipelines = (flags.pipelines ? flags.pipelines.split(',') : DEFAULT_PIPELINES).map(s => s.trim()).filter(Boolean);
  const models = (flags.models ? flags.models.split(',') : DEFAULT_MODELS).map(s => s.trim()).filter(Boolean);
  const cases = (flags.cases ? flags.cases.split(',') : DEFAULT_CASES).map(s => s.trim()).filter(Boolean);
  const scenarios = (flags.scenarios ? flags.scenarios.split(',') : DEFAULT_SCENARIOS).map(s => s.trim()).filter(Boolean);
  const budgetUsd = Number(flags['budget-usd'] ?? 0.25);
  const reasoningEffort = flags['reasoning-effort'] || undefined;
  const providerOnly = flags['provider-only'] && flags['provider-only'] !== 'none'
    ? flags['provider-only'].split(',').map(s => s.trim()).filter(Boolean)
    : null;
  const baselineSummary = path.resolve(flags['baseline-summary'] || DEFAULT_BASELINE);

  for (const p of pipelines) {
    if (!['a1', 'a2'].includes(p)) throw new Error(`Unsupported pipeline: ${p}`);
  }
  for (const s of scenarios) {
    if (!ALL_SCENARIOS.includes(s)) throw new Error(`Unsupported scenario: ${s}`);
  }
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 5) {
    throw new Error('budget-usd must be between 0 and 5');
  }
  return {
    outDir: path.resolve(outDir),
    pipelines,
    models,
    cases,
    scenarios,
    budgetUsd,
    reasoningEffort,
    providerOnly,
    baselineSummary,
  };
}

async function loadOpenRouterApiKey() {
  if (process.env.OPENROUTER_API_KEY?.trim()) return process.env.OPENROUTER_API_KEY.trim();
  for (const candidate of [path.join(ROOT, '.env'), FALLBACK_MAIN_ENV]) {
    if (!existsSync(candidate)) continue;
    const text = await readFile(candidate, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key === 'OPENROUTER_API_KEY' && val) return val;
    }
  }
  throw new Error('OPENROUTER_API_KEY is required in environment or .env');
}

async function fetchOpenRouterCatalog() {
  const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Failed to fetch OpenRouter catalog (${response.status})`);
  return response.json();
}

async function spawnPythonPipeline({ pipeline, baseUrl, model, apiKey, reasoningEffort }) {
  const pythonBin = path.join(ROOT, 'runners/studybuddy-pipeline/.venv/bin/python');
  if (!existsSync(pythonBin)) {
    throw new Error(`Python venv missing at ${pythonBin}`);
  }
  const args = [
    '-m', 'studybuddy_pipeline.cli',
    '--pipeline', pipeline,
    '--base-url', baseUrl,
    '--model', model,
    '--port', '0',
    '--mode', 'live',
  ];
  if (reasoningEffort) args.push('--reasoning-effort', reasoningEffort);

  const child = spawn(pythonBin, args, {
    cwd: path.join(ROOT, 'runners/studybuddy-pipeline'),
    env: { ...process.env, STUDY_RUNNER_API_KEY: apiKey },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${pipeline} ready line. stderr=${stderr.slice(-500)}`)), 20_000);
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Runner ${pipeline} exited early (${code}): ${stderr.slice(-500)}`));
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
          // Wait for complete line
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

function fmtTokens(usage) {
  if (usage?.availability !== 'available') return 'unknown';
  return `${Number(usage.inputTokens || 0).toLocaleString('en-US')} / ${Number(usage.outputTokens || 0).toLocaleString('en-US')}`;
}

export function formatComparisonMarkdown({ generatedAt, rows, baselineRows, totalObservedUsd }) {
  const lines = [
    `# Approach A1 & A2 vs. Approach B Live Comparison (${generatedAt.slice(0, 10)})`,
    '',
    `- **Harness:** Real Docker Calendarpit (\`ghcr.io/iktakahiro/calendarpit:0.9.7\`) + local SQLite budgeted OpenRouter gateway (\`$0.25\`/run cap) + independent Python probe`,
    `- **Total observed OpenRouter spend (this A1+A2 matrix):** \`$${totalObservedUsd.toFixed(4)}\` USD across ${rows.length} run(s)`,
    `- **Approach B baseline source:** \`docs/evidence/live-single-agent-baseline-2026-11-24/summary.json\` (\`scripts/compare-live-models.mjs\`, \`success\` scenario)`,
    '',
    '## Head-to-Head Comparison (\`success\` Scenario: A1 vs. A2 vs. B)',
    '',
    '| Approach | Model | Case | Overall | Probe | Duration | LLM Calls | Validation Retries | Questions (Turns) | Input / Output Tokens | Observed USD | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  const successRows = rows.filter(r => r.scenario === 'success');
  const unified = [
    ...successRows.map(r => ({
      approach: `**${r.pipeline.toUpperCase()}**`,
      model: r.model,
      caseId: r.caseId,
      passed: r.passed,
      probeOk: r.probeOk,
      durationMs: r.durationMs,
      llmCalls: r.llmCalls,
      retries: r.validationRetries,
      questionsAsked: r.questionsAsked,
      questionTurns: r.questionTurns,
      usage: r.usage,
      observedUsd: r.observedUsd,
      notes: r.passed
        ? 'All checks passed; retirement verified'
        : [...r.failedCheckDetails.map(c => `${c.id}: ${c.detail}`), ...r.failureMessages].filter(Boolean).slice(0, 2).join('; '),
    })),
    ...baselineRows.map(b => ({
      approach: '**B** (single-agent)',
      model: b.model,
      caseId: b.caseId,
      passed: b.passed,
      probeOk: b.probeOk,
      durationMs: b.durationMs,
      llmCalls: b.llmSteps,
      retries: b.toolErrorCount,
      questionsAsked: b.questionsAsked,
      questionTurns: b.questionTurns,
      usage: b.usage,
      observedUsd: b.observedUsd,
      notes: b.passed
        ? `Baseline (${b.toolCallCount} tool calls, ${b.toolErrorCount} tool errs)`
        : [...(b.failedCheckDetails || []).map(c => `${c.id}: ${c.detail}`), ...(b.failureMessages || [])].slice(0, 2).join('; '),
    })),
  ].sort((x, y) => x.model.localeCompare(y.model) || x.caseId.localeCompare(y.caseId) || x.approach.localeCompare(y.approach));

  for (const r of unified) {
    lines.push(
      `| ${r.approach} | \`${r.model}\` | \`${r.caseId}\` | **${r.passed ? 'PASS' : 'FAIL'}** | ${r.probeOk ? 'PASS' : 'FAIL'} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.llmCalls} | ${r.retries} | ${r.questionsAsked} (${r.questionTurns}) | ${fmtTokens(r.usage)} | $${Number(r.observedUsd || 0).toFixed(4)} | ${String(r.notes).replace(/\|/g, '\\|')} |`,
    );
  }

  lines.push(
    '',
    '## Full Matrix (`success` & `stale` Safety Scenarios for A1 & A2)',
    '',
    '| Pipeline | Model | Case | Scenario | Overall | Probe | Duration | LLM Calls | Retries | Tools | Input / Output Tokens | Observed USD | Failure / Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of rows) {
    const notes = r.passed
      ? 'Passed; retirement verified'
      : [...r.failedCheckDetails.map(c => `${c.id}: ${c.detail}`), ...r.failureMessages].filter(Boolean).slice(0, 2).join('; ');
    lines.push(
      `| \`${r.pipeline}\` | \`${r.model}\` | \`${r.caseId}\` | \`${r.scenario}\` | **${r.passed ? 'PASS' : 'FAIL'}** | ${r.probeOk ? 'PASS' : 'FAIL'} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.llmCalls} | ${r.validationRetries} | ${r.toolCallCount} (${r.toolErrorCount} err) | ${fmtTokens(r.usage)} | $${Number(r.observedUsd || 0).toFixed(4)} | ${notes.replace(/\|/g, '\\|')} |`,
    );
  }

  const summarizeGroup = (label, subset) => {
    const passed = subset.filter(r => r.passed).length;
    const total = subset.length;
    const avgMs = total ? Math.round(subset.reduce((s, r) => s + r.durationMs, 0) / total) : 0;
    const avgCost = total ? subset.reduce((s, r) => s + (r.observedUsd || 0), 0) / total : 0;
    const avgCalls = total ? (subset.reduce((s, r) => s + (r.llmCalls || 0), 0) / total).toFixed(1) : '0';
    return `- **${label}:** ${passed}/${total} PASS, avg ${(avgMs / 1000).toFixed(1)}s/run, avg ${avgCalls} LLM calls, avg $${avgCost.toFixed(4)}/run`;
  };

  const a1Success = rows.filter(r => r.pipeline === 'a1' && r.scenario === 'success');
  const a2Success = rows.filter(r => r.pipeline === 'a2' && r.scenario === 'success');
  const a1All = rows.filter(r => r.pipeline === 'a1');
  const a2All = rows.filter(r => r.pipeline === 'a2');

  lines.push(
    '',
    '## Aggregate Findings',
    '',
    summarizeGroup('Approach A1 (5-stage StudyBuddy roles, `success`)', a1Success),
    summarizeGroup('Approach A2 (typed state-machine + code verifier, `success`)', a2Success),
    summarizeGroup('Approach A1 (all `success` + `stale` runs)', a1All),
    summarizeGroup('Approach A2 (all `success` + `stale` runs)', a2All),
    '',
  );

  for (const pipeline of ['a1', 'a2']) {
    const sample = rows.find(r => r.pipeline === pipeline && r.scenario === 'success' && Array.isArray(r.rastro) && r.rastro.length);
    if (!sample) continue;
    lines.push(`### Sample \`Evento\` Rastro (\`${pipeline.toUpperCase()}\`, \`${sample.model}\`, \`${sample.caseId}\`)`, '', '```text');
    for (const ev of sample.rastro) {
      lines.push(`[${ev.agente}] ${ev.acao}: ${ev.detalhe} (${Number(ev.segundos || 0).toFixed(2)}s, llm=${ev.llm_calls ?? 0})`);
    }
    lines.push('```', '');
  }

  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = await loadOpenRouterApiKey();
  const verifiedAt = new Date().toISOString();
  const catalog = await fetchOpenRouterCatalog();
  const pricingByModel = new Map(opts.models.map(m => [m, extractCatalogPricing(catalog, m, verifiedAt)]));

  let baselineRows = [];
  if (existsSync(opts.baselineSummary)) {
    const parsedBaseline = JSON.parse(await readFile(opts.baselineSummary, 'utf8'));
    baselineRows = (parsedBaseline.rows || []).filter(
      r => opts.models.includes(r.model) && opts.cases.includes(r.caseId),
    );
  }

  await mkdir(opts.outDir, { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), 'study-compare-a-vs-b-'));
  const rows = [];

  try {
    const bundles = {};
    for (const caseId of opts.cases) {
      const dir = path.join(work, `bundle-${caseId}`);
      await packBundle(caseId, dir);
      bundles[caseId] = { dir, bundle: await readBundle(dir) };
    }

    for (const pipeline of opts.pipelines) {
      for (const model of opts.models) {
        const pricing = pricingByModel.get(model);
        for (const caseId of opts.cases) {
          for (const scenario of opts.scenarios) {
            const slug = `${pipeline}__${model.replace(/[^a-z0-9]+/gi, '-')}__${caseId}__${scenario}`;
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

            const runner = await spawnPythonPipeline({
              pipeline,
              baseUrl: gatewayUrl,
              model,
              apiKey: accessToken,
              reasoningEffort: opts.reasoningEffort,
            });

            const resultFilename = `${slug}.result.json`;
            const resultPath = path.join(opts.outDir, resultFilename);
            let runOutcome;
            let trace = null;

            try {
              runOutcome = await runPortableReplay(bundles[caseId].bundle, scenario, {
                adapter: createHttpRunnerAdapter({
                  url: runner.url,
                  engine: { name: `StudyBuddy ${pipeline.toUpperCase()} (${model})`, mode: 'live', model },
                  timeoutMs: 300_000,
                }),
                saveResult: async evidence => {
                  await writeFile(resultPath, JSON.stringify(evidence, null, 2) + '\n');
                },
              });
              const traceRes = await fetch(`${runner.url}/runs/${encodeURIComponent(runOutcome.result.runId)}/trace`);
              if (traceRes.ok) trace = await traceRes.json();
            } finally {
              await runner.close();
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
            const questions = result.timeline.filter(e => e.kind === 'question');
            const row = {
              pipeline,
              model,
              caseId,
              scenario,
              pricing,
              passed: failures.length === 0 && failedChecks.length === 0 && result.retirement === 'verified' && probeOk,
              retirement: result.retirement,
              probeOk,
              probeOutput,
              durationMs: result.durationMs,
              llmCalls: trace?.llmCalls ?? 0,
              toolCallCount: trace?.toolCalls ?? result.engine.tools.length,
              toolErrorCount: trace?.toolErrors?.length ?? 0,
              toolErrors: trace?.toolErrors ?? [],
              validationRetries: trace?.validationRetries ?? 0,
              questionsAsked: trace?.questionsAsked ?? questions.length,
              questionTurns: trace?.questionTurns ?? 0,
              usage: result.usage,
              observedUsd: budgetSummary.observedUsd,
              checks: Object.fromEntries(result.checks.map(c => [c.id, c.outcome])),
              failedCheckDetails: failedChecks,
              failureMessages: failures.map(f => f.message),
              rastro: trace?.rastro ?? [],
              resultFile: resultFilename,
            };
            rows.push(row);
            console.log(JSON.stringify({
              slug,
              passed: row.passed,
              probeOk: row.probeOk,
              durationMs: row.durationMs,
              llmCalls: row.llmCalls,
              validationRetries: row.validationRetries,
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
      }
    }

    const generatedAt = new Date().toISOString();
    const totalObservedUsd = rows.reduce((s, r) => s + (Number(r.observedUsd) || 0), 0);
    const summaryPayload = {
      generatedAt,
      pipelines: opts.pipelines,
      models: opts.models,
      cases: opts.cases,
      scenarios: opts.scenarios,
      budgetPerRunUsd: opts.budgetUsd,
      totalObservedUsd,
      rows,
      baselineApproachB: baselineRows,
    };
    await writeFile(path.join(opts.outDir, 'summary.json'), JSON.stringify(summaryPayload, null, 2) + '\n');
    await writeFile(
      path.join(opts.outDir, 'README.md'),
      formatComparisonMarkdown({ generatedAt, rows, baselineRows, totalObservedUsd }),
    );
    console.log(JSON.stringify({ done: true, totalObservedUsd, summary: path.join(opts.outDir, 'summary.json') }));
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
