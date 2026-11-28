import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { formatUsd } from '../foundation/model-budget.mjs';
import { ARMS } from './arms.mjs';
import { JUDGE_MODELS, rubric } from './judge-b2.mjs';
import { archetypes } from './case-schema.mjs';

const SIDES = [['H0', 'C1'], ['H0', 'C3'], ['C1', 'C3']];
const rate = (passed, n) => n ? passed / n : null;
const key = (...values) => JSON.stringify(values);
const quality = row => row.status !== 'completed' ? null : !row.passed ? 0 : row.outcome === 'honest_abstention' ? 1 : 2;
const groups = (values, by) => {
  const index = new Map();
  for (const value of values) {
    const id = by(value);
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(value);
  }
  return [...index.values()];
};

function summary(rows) {
  const completed = rows.filter(row => quality(row) !== null);
  const passed = completed.filter(row => row.passed).length;
  return { runs: rows.length, n: completed.length, passed, failed: completed.length - passed, passRate: rate(passed, completed.length),
    infrastructureErrors: rows.filter(row => row.status === 'infrastructure_error').length,
    compatibilityErrors: rows.filter(row => row.status === 'compatibility_error').length };
}

function pairwise(rows) {
  const blocks = groups(rows, row => key(row.caseId, row.repeat, row.model, row.provider));
  return SIDES.map(([left, right]) => {
    const pairs = [];
    for (const block of blocks) {
      const side = arm => {
        const matching = block.filter(row => row.arm === arm);
        return matching.length === 1 ? quality(matching[0]) : null;
      };
      const a = side(left), b = side(right);
      const result = a === null || b === null ? 'missing' :
        a === 0 && b === 0 ? 'both_failed' : a > b ? 'left_win' : a < b ? 'right_win' : 'tie';
      const { caseId, repeat, model, provider } = block[0];
      pairs.push({ caseId, repeat, model, provider, result });
    }
    const count = result => pairs.filter(pair => pair.result === result).length;
    return { left, right, n: pairs.length - count('missing'), leftWins: count('left_win'), rightWins: count('right_win'),
      ties: count('tie'), bothFailed: count('both_failed'), missing: count('missing'), pairs };
  });
}

function repeats(rows) {
  return groups(rows, row => key(row.caseId, row.arm, row.model, row.provider)).map(group => {
    const { caseId, arm, model, provider } = group[0];
    const scores = group.map(quality).filter(value => value !== null);
    const complete = group.length === 2 && scores.length === 2 && new Set(group.map(row => row.repeat)).size === 2;
    return { caseId, arm, model, provider, n: scores.length,
      disagrees: complete ? scores[0] !== scores[1] : null };
  });
}

export function stage1Screen(allRows, tieBreakCaseId) {
  const rows = allRows.filter(row => row.caseId !== tieBreakCaseId);
  const cases = [...new Set(rows.map(row => row.caseId))];
  const sorted = groups(rows, row => key(row.model, row.provider)).map(group => {
    const { model, provider } = group[0];
    const cells = cases.flatMap(caseId => ['H0', 'C1'].map(arm => {
      const matching = group.filter(row => row.caseId === caseId && row.arm === arm && row.repeat === 1);
      const score = matching.length === 1 ? quality(matching[0]) : null;
      return { caseId, arm, passed: score === null ? null : score > 0 };
    }));
    // Do not rank a partial model or reweight away a missing cell.
    const complete = cases.length === 2 && group.length === 4 && cells.every(cell => cell.passed !== null);
    return { model, provider, cells, score: complete ? cells.filter(cell => cell.passed).length / 4 : null };
  }).sort((left, right) => (right.score ?? -1) - (left.score ?? -1) || left.model.localeCompare(right.model, 'en'));
  const ranked = sorted.filter(item => item.score !== null);
  const ties = ranked.filter(item => item.score === ranked[0].score).map(item => item.model);
  const inversions = [];
  for (const [index, left] of ranked.entries()) {
    for (const right of ranked.slice(index + 1)) {
      const strata = [['H0', 'C1'].map(arm => cell => cell.arm === arm),
        cases.map(caseId => cell => cell.caseId === caseId)];
      for (const [dimension, predicates] of strata.entries()) {
        const differences = predicates.map(predicate => left.cells.filter(cell => predicate(cell) && cell.passed).length -
          right.cells.filter(cell => predicate(cell) && cell.passed).length);
        if (differences.some(value => value > 0) && differences.some(value => value < 0)) {
          inversions.push({ left: left.model, right: right.model, across: dimension === 0 ? 'arms' : 'cases' });
        }
      }
    }
  }
  const finalists = new Set(ties);
  for (const item of inversions) {
    if (ties.includes(item.left) || ties.includes(item.right)) {
      finalists.add(item.left);
      finalists.add(item.right);
    }
  }
  const tieBreakNeeded = finalists.size > 1;
  const tieBreak = ranked.filter(item => finalists.has(item.model)).map(item => {
    const observed = allRows.filter(row => row.caseId === tieBreakCaseId && row.model === item.model &&
      row.provider === item.provider && row.repeat === 1);
    const complete = observed.length === 2 && ['H0', 'C1'].every(arm =>
      observed.some(row => row.arm === arm && quality(row) !== null));
    const passes = item.cells.filter(cell => cell.passed).length;
    return { model: item.model, provider: item.provider,
      score: complete ? (passes + observed.filter(row => row.passed).length) / 6 : null };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const winner = tieBreakNeeded
    ? (tieBreak.every(item => item.score !== null) && tieBreak[0].score > tieBreak[1].score ? tieBreak[0] : null)
    : ranked[0] ?? null;
  return { ranking: sorted, topTie: ties.length > 1 ? ties : [], inversions, tieBreakNeeded,
    preselectedThirdCaseId: tieBreakCaseId ?? null, finalistModels: [...finalists], tieBreak, winner };
}

const evidenceDigest = evidence => createHash('sha256').update(JSON.stringify(evidence)).digest('hex');

export function createStage1Decision({ runs, models, tieBreakCaseId = null }) {
  const evidence = { models, tieBreakCaseId, runs: runs.map(({ caseId, split, arm, repeat, model, provider, status, passed, eligible }) =>
    ({ caseId, split, arm, repeat, model, provider, status, passed, eligible })) };
  const screen = stage1Screen(evidence.runs, tieBreakCaseId);
  const base = evidence.runs.filter(row => row.caseId !== tieBreakCaseId);
  const expanded = evidence.runs.filter(row => row.caseId === tieBreakCaseId);
  if (models.length !== 5 || new Set(models.map(pin => pin.model)).size !== 5 ||
      base.length !== 20 || screen.ranking.length !== 5 || screen.ranking.some(row => row.score === null) ||
      evidence.runs.some(row => row.split !== 'dev' || row.repeat !== 1 || !['H0', 'C1'].includes(row.arm) ||
        row.status !== 'completed' || typeof row.passed !== 'boolean' || row.eligible !== row.passed ||
        !models.some(pin => pin.model === row.model && pin.provider === row.provider)) ||
      expanded.length !== (screen.tieBreakNeeded ? screen.finalistModels.length * 2 : 0)) return null;
  if (screen.winner) {
    const finalist = models.find(pin => pin.model === screen.winner.model && pin.provider === screen.winner.provider);
    return { version: 1, finalist, evidence, sha256: evidenceDigest(evidence) };
  }
  if (screen.tieBreakNeeded && screen.tieBreak.length >= 2 && screen.tieBreak.every(item => item.score !== null)) {
    const topScore = screen.tieBreak[0].score;
    const finalists = screen.tieBreak.filter(item => item.score === topScore)
      .map(item => models.find(pin => pin.model === item.model && pin.provider === item.provider))
      .filter(Boolean);
    if (finalists.length >= 2) {
      return { version: 1, finalist: null, finalists, evidence, sha256: evidenceDigest(evidence) };
    }
  }
  return null;
}

export function verifyStage1Decision(decision, pin) {
  const evidence = decision?.evidence;
  const checked = Array.isArray(evidence?.runs) && Array.isArray(evidence?.models)
    ? createStage1Decision(evidence) : null;
  const singleMatch = checked?.finalist && isDeepStrictEqual(checked.finalist, decision?.finalist) &&
    decision?.finalists === undefined && isDeepStrictEqual(checked.finalist, pin);
  const tieMatch = !checked?.finalist && decision?.finalist === null && Array.isArray(checked?.finalists) &&
    isDeepStrictEqual(checked.finalists, decision?.finalists) &&
    checked.finalists.some(item => isDeepStrictEqual(item, pin));
  if (!checked || decision.version !== 1 || checked.sha256 !== decision.sha256 || (!singleMatch && !tieMatch)) {
    throw Object.assign(new Error('Stage 1 evidence does not support the configured finalist'), { code: 'stage1_decision_invalid' });
  }
  return singleMatch ? checked.finalist : pin;
}

function describeJudges(rows) {
  return Object.fromEntries(JUDGE_MODELS.map(model => {
    const available = rows.filter(row => row.grades?.[model]?.descriptiveOnly === true);
    const items = Object.fromEntries(Object.keys(rubric).map(item => {
      const values = available.map(row => row.grades[model].grades[item]).filter(value => value != null);
      const aggregate = rubric[item].type === 'score'
        ? { mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
        : { counts: Object.fromEntries([...new Set(values)].map(value => [value, values.filter(other => other === value).length])) };
      return [item, { n: values.length, missing: rows.length - values.length, ...aggregate }];
    }));
    const column = model === JUDGE_MODELS[2] ? 'mistral-large-4-0' : model;
    return [column, { descriptiveOnly: true, n: available.length, missing: rows.length - available.length, items }];
  }));
}

function nullResult(rows, pairs) {
  const byCase = groups(rows, row => row.caseId);
  const complete = rows.length === 30 && byCase.length === 5 &&
    rows.every(row => row.split === 'sealed' && quality(row) !== null) &&
    new Set(rows.map(row => key(row.model, row.provider))).size === 1 &&
    new Set(byCase.map(group => group[0].archetype)).size === archetypes.length &&
    byCase.every(group => group.every(row => row.archetype === group[0].archetype) && group.length === 6 &&
      ARMS.every(arm => [1, 2].every(repeat => group.some(row => row.arm === arm && row.repeat === repeat))));
  const h0PassesAll = complete && rows.filter(row => row.arm === 'H0').every(row => row.passed && row.eligible);
  const h0TiesAll = complete && pairs.filter(pair => pair.left === 'H0').every(pair => pair.n === 10 && pair.ties === 10);
  return { complete, h0PassesAll, h0TiesAll, met: h0PassesAll && h0TiesAll,
    recommendation: h0PassesAll && h0TiesAll ? 'H0' : null };
}

export function buildReport({ runs, stage, tieBreakCaseId }) {
  if (stage !== 'dev' && stage !== 'sealed') throw new Error('Unknown evaluation stage');
  const pairs = pairwise(runs);
  const lookup = runs.filter(row => row.archetype === 'long_pdf_lookup');
  const knownSpend = runs.filter(row => Number.isFinite(row.spendUsd) && row.spendUsd >= 0);
  const gateNames = [...new Set(runs.flatMap(row => Object.keys(row.gates ?? {})))].sort();
  const totalUsd = runs.length && knownSpend.length === runs.length
    ? knownSpend.reduce((sum, row) => sum + row.spendUsd, 0) : null;
  const formatted = formatUsd(totalUsd);
  return {
    stage,
    totals: summary(runs),
    byArm: Object.fromEntries(ARMS.map(arm => [arm, summary(runs.filter(row => row.arm === arm))])),
    gates: Object.fromEntries(gateNames.map(name => {
      const observed = runs.filter(row => row.status === 'completed' && row.gates?.[name]);
      const passed = observed.filter(row => row.gates[name].passed).length;
      return [name, { n: observed.length, passed, passRate: rate(passed, observed.length), missing: runs.length - observed.length }];
    })),
    pairs: stage === 'dev' ? pairs.filter(pair => pair.right === 'C1') : pairs,
    withinCaseRepeats: stage === 'sealed' ? repeats(runs) : [],
    case2: Object.fromEntries(ARMS.map(arm => {
      const rows = lookup.filter(row => row.arm === arm);
      return [arm, { ...summary(rows), lookupResolved: rows.filter(row => row.outcome === 'lookup_resolved' && row.passed).length,
        honestAbstention: rows.filter(row => row.outcome === 'honest_abstention' && row.passed).length }];
    })),
    spend: { total: formatted === '$0.0000' ? (totalUsd === 0 ? '$0' : '<$0.0001') : formatted,
      knownRuns: knownSpend.length, unknownRuns: runs.length - knownSpend.length },
    descriptiveJudges: describeJudges(runs),
    devScreen: stage === 'dev' ? stage1Screen(runs, tieBreakCaseId) : null,
    nullResult: stage === 'sealed' ? nullResult(runs, pairs) : null,
  };
}
