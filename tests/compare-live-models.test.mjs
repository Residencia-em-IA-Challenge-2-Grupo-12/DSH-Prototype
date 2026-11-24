import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_CASES,
  DEFAULT_MODELS,
  extractCatalogPricing,
  formatSummaryMarkdown,
  parseCompareArgs,
} from '../scripts/compare-live-models.mjs';

test('parseCompareArgs validates flags and supplies safe defaults', () => {
  const parsed = parseCompareArgs(['--out-dir', '/tmp/live-out']);
  assert.deepEqual(parsed.models, DEFAULT_MODELS);
  assert.deepEqual(parsed.cases, DEFAULT_CASES);
  assert.equal(parsed.scenario, 'success');
  assert.equal(parsed.budgetUsd, 0.25);
  assert.equal(parsed.maxSteps, 24);
  assert.equal(parsed.providerOnly, null);
  assert.equal(parsed.outDir, path.resolve('/tmp/live-out'));

  const custom = parseCompareArgs([
    '--out-dir', '/tmp/x',
    '--models', 'openai/gpt-6-luna,deepseek/deepseek-v4.1-flash-1017',
    '--cases', 'bruno',
    '--scenario', 'stale',
    '--budget-usd', '0.5',
    '--max-steps', '16',
    '--reasoning-effort', 'low',
    '--provider-only', 'deepseek',
  ]);
  assert.deepEqual(custom.models, ['openai/gpt-6-luna', 'deepseek/deepseek-v4.1-flash-1017']);
  assert.deepEqual(custom.cases, ['bruno']);
  assert.equal(custom.scenario, 'stale');
  assert.equal(custom.budgetUsd, 0.5);
  assert.equal(custom.maxSteps, 16);
  assert.equal(custom.reasoningEffort, 'low');
  assert.deepEqual(custom.providerOnly, ['deepseek']);

  assert.throws(() => parseCompareArgs([]), /Usage:/);
  assert.throws(() => parseCompareArgs(['--out-dir', '/tmp/x', '--scenario', 'bogus']), /Unknown scenario/);
  assert.throws(() => parseCompareArgs(['--out-dir', '/tmp/x', '--budget-usd', '99']), /budget-usd/);
});

test('extractCatalogPricing converts OpenRouter per-token rates to per-million rates', () => {
  const catalog = {
    data: [
      { id: 'openai/gpt-6-luna', pricing: { prompt: '0.0000001', completion: '0.0000005' } },
      { id: 'deepseek/deepseek-v4.1-flash-1017', pricing: { prompt: '0.00000003', completion: '0.0000002' } },
    ],
  };
  const luna = extractCatalogPricing(catalog, 'openai/gpt-6-luna', '2026-11-24T00:00:00Z');
  assert.deepEqual(luna, { inputPerMillion: 0.1, outputPerMillion: 0.5, verifiedAt: '2026-11-24T00:00:00Z' });
  const ds = extractCatalogPricing(catalog, 'deepseek/deepseek-v4.1-flash-1017', '2026-11-24T00:00:00Z');
  assert.deepEqual(ds, { inputPerMillion: 0.03, outputPerMillion: 0.2, verifiedAt: '2026-11-24T00:00:00Z' });
  assert.throws(() => extractCatalogPricing(catalog, 'missing/model'), /not found/i);
});

test('formatSummaryMarkdown renders a clean comparison table with total cost', () => {
  const md = formatSummaryMarkdown({
    generatedAt: '2026-11-24T20:00:00Z',
    scenario: 'success',
    rows: [
      {
        model: 'openai/gpt-6-luna',
        caseId: 'bruno',
        passed: true,
        probeOk: true,
        durationMs: 42_500,
        llmSteps: 12,
        toolCallCount: 11,
        toolErrorCount: 0,
        questionsAsked: 2,
        questionTurns: 1,
        usage: { availability: 'available', inputTokens: 120_000, outputTokens: 4_500 },
        observedUsd: 0.0075,
        failedCheckDetails: [],
        failureMessages: [],
      },
    ],
  });
  assert.match(md, /\$0\.0075/);
  assert.match(md, /openai\/gpt-6-luna/);
  assert.match(md, /\*\*PASS\*\*/);
  assert.match(md, /2 \(1\)/);
});
