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

function screening(rows, tieBreakCaseId) {
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
  return { ranking: sorted, topTie: ties.length > 1 ? ties : [], inversions,
    tieBreakNeeded: ties.length > 1 || inversions.some(item => ties.includes(item.left) || ties.includes(item.right)),
    preselectedThirdCaseId: tieBreakCaseId ?? null };
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
  if (tieBreakCaseId && runs.some(row => row.caseId === tieBreakCaseId)) throw new Error('Tie-break case must be reserved');
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
    devScreen: stage === 'dev' ? screening(runs, tieBreakCaseId) : null,
    nullResult: stage === 'sealed' ? nullResult(runs, pairs) : null,
  };
}
