import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { digest, makePlan } from '../src/domain/planner.mjs';
import {
  evaluatePlan,
  invokeCpSat,
  renderMarkdownReport,
  resolvePythonBinary,
  runComparison,
} from '../experiments/planner-comparison/benchmark.mjs';
import { ROOT, loadComparisonSuite } from '../experiments/planner-comparison/cases.mjs';

function hasOrtools(pythonBin) {
  try {
    const out = execFileSync(pythonBin, [resolve(ROOT, 'experiments/planner-comparison/cpsat_planner.py'), '--check-available'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return JSON.parse(out).available === true;
  } catch {
    return false;
  }
}

test('comparison suite loads frozen, paired-replay, and diagnostic cases with verified fixture hashes', () => {
  const suite = loadComparisonSuite();
  assert.equal(suite.cases.length, 12);
  assert.equal(suite.cases.filter(c => c.group === 'frozen').length, 6);
  assert.equal(suite.cases.filter(c => c.group === 'paired-replay').length, 4);
  assert.equal(suite.cases.filter(c => c.group === 'diagnostic').length, 2);
  assert.equal(suite.cases.filter(c => c.heldOut).length, 3);
});

test('corrected heuristic satisfies hard constraints on all cases and shows the boundary packing shortfall', () => {
  const suite = loadComparisonSuite();
  const meta = { clock: suite.clock, sessionMinutes: suite.sessionMinutes, slotMinutes: suite.slotMinutes };

  for (const scenario of suite.cases) {
    for (const variant of scenario.variants) {
      const profile = { ...scenario.profile, ...variant.profileOverrides };
      const options = {
        weeks: scenario.weeks,
        avoidDates: scenario.avoidDates,
        focusCourse: scenario.focusCourse,
        preferredPeriod: scenario.preferredPeriod,
        today: suite.clock.date,
        ...variant.options,
      };
      const plan = makePlan(profile, scenario.events, options);
      const evaluation = evaluatePlan(plan, scenario, profile, options, meta);
      assert.deepEqual(evaluation.findings, [], `${scenario.id}/${variant.name}`);
      if (scenario.group !== 'diagnostic') {
        assert.deepEqual(evaluation.scheduledMinutesByWeek, scenario.knownFeasibleMinutes, `${scenario.id}/${variant.name}`);
      }
      if (scenario.id === 'preferred-period-boundary-packing') {
        assert.equal(evaluation.totalScheduledMinutes, 60);
        assert.equal(evaluation.avoidableShortfallMinutes, 60);
      }
    }
  }
});

test('CP-SAT adapter reports UNAVAILABLE cleanly without heuristic fallback when OR-Tools is absent', t => {
  if (hasOrtools('python3')) {
    t.skip('System python3 has ortools installed; cannot exercise missing-ortools fallback via bare python3');
    return;
  }
  const suite = loadComparisonSuite();
  const sample = suite.cases[0];
  const resp = invokeCpSat(
    { student: sample.profile, events: sample.events, options: { weeks: 1 } },
    { pythonBin: 'python3', hostTimeoutMs: 5000 },
  );
  assert.equal(resp.plan, null);
  assert.equal(resp.solver.status, 'UNAVAILABLE');
  assert.equal(resp.solver.targetFeasibility, 'unavailable');
});

test('checked-in evidence bundle matches current planner/fixture hashes and records zero hard-constraint violations', () => {
  const summaryPath = resolve(ROOT, 'docs/evidence/planner-heuristic-vs-cpsat-2026-11-25/summary.json');
  const readmePath = resolve(ROOT, 'docs/evidence/planner-heuristic-vs-cpsat-2026-11-25/README.md');
  assert.ok(existsSync(summaryPath), 'Missing summary.json evidence');
  assert.ok(existsSync(readmePath), 'Missing README.md evidence');

  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const suite = loadComparisonSuite();
  assert.deepEqual(summary.hashes, suite.hashes);
  assert.equal(summary.environment.cpSatAvailable, true);
  assert.equal(summary.aggregates.coreCombined.heuristic.hardConstraintPassCount, summary.aggregates.coreCombined.heuristic.availableVariantCount);
  assert.equal(summary.aggregates.coreCombined.cpsat.hardConstraintPassCount, summary.aggregates.coreCombined.cpsat.availableVariantCount);
  assert.equal(summary.aggregates.coreCombined.cpsat.totalAvoidableShortfallMinutes, 0);
});

test('CP-SAT prototype matches planner.mjs contract, beats order/coverage/boundary gaps, and proves strict infeasibility', t => {
  const pythonBin = resolvePythonBinary();
  if (!hasOrtools(pythonBin)) {
    t.skip(`OR-Tools not available in ${pythonBin}; skipping live CP-SAT comparison assertions`);
    return;
  }

  const suite = loadComparisonSuite();
  const summary = runComparison({ pythonBin, repeats: 2, hostTimeoutMs: 15_000, maxTimeSeconds: 5.0 });
  assert.equal(summary.environment.cpSatAvailable, true);

  for (const row of summary.cases) {
    const rawCase = suite.cases.find(c => c.id === row.id);
    const expectedBaseHash = digest(rawCase.events);
    for (const [vName, pair] of Object.entries(row.variants)) {
      assert.deepEqual(pair.heuristic.findings, [], `Heuristic findings on ${row.id}/${vName}`);
      assert.deepEqual(pair.cpsat.findings, [], `CP-SAT findings on ${row.id}/${vName}`);
      assert.equal(pair.cpsat.status, 'OPTIMAL', `Expected OPTIMAL on ${row.id}/${vName}`);
      assert.equal(pair.cpsat.deterministic, true, `Expected deterministic CP-SAT on ${row.id}/${vName}`);
      assert.equal(pair.cpsat.avoidableShortfallMinutes, 0, `Expected zero avoidable shortfall on ${row.id}/${vName}`);
      assert.equal(pair.cpsat.baseHash, expectedBaseHash, `baseHash mismatch on ${row.id}/${vName}`);
    }
  }

  const brunoEqual = summary.cases.find(c => c.id === 'bruno-equal-cutoff');
  assert.equal(brunoEqual.orderSensitivity.heuristic.courseOrderInvariant, false);
  assert.equal(brunoEqual.orderSensitivity.cpsat.courseOrderInvariant, true);
  assert.deepEqual(brunoEqual.orderSensitivity.cpsat.defaultPerCourse, { 'Banco de Dados': 900, Algoritmos: 900 });

  const anaEarlier = summary.cases.find(c => c.id === 'ana-earlier-deadline');
  assert.equal(anaEarlier.variants.default.heuristic.coveredFeasibleCourses, 1);
  assert.equal(anaEarlier.variants.default.cpsat.coveredFeasibleCourses, 2);

  const ravi = summary.cases.find(c => c.id === 'ravi-shift-exception');
  assert.equal(ravi.variants.default.heuristic.coveredFeasibleCourses, 1);
  assert.equal(ravi.variants.default.cpsat.coveredFeasibleCourses, 2);

  const brunoFocus = summary.cases.find(c => c.id === 'bruno-explicit-priority');
  assert.ok(brunoFocus.variants.default.cpsat.perCourse.Algoritmos > brunoFocus.variants.default.cpsat.perCourse['Banco de Dados']);
  assert.ok(brunoFocus.variants.default.cpsat.perCourse['Banco de Dados'] > 0);

  const boundary = summary.cases.find(c => c.id === 'preferred-period-boundary-packing');
  assert.equal(boundary.variants.default.heuristic.totalScheduledMinutes, 60);
  assert.equal(boundary.variants.default.cpsat.totalScheduledMinutes, 120);

  for (const shortfallId of [
    'bruno-tight-capacity',
    'bruno-expired-course',
    'ravi-shift-exception',
    'zero-capacity-infeasible-target',
  ]) {
    const row = summary.cases.find(c => c.id === shortfallId);
    assert.equal(row.variants.default.cpsat.targetFeasibility, 'proved_shortfall', shortfallId);
    assert.equal(row.variants.default.cpsat.strictTargetProbe?.status, 'INFEASIBLE', shortfallId);
    assert.equal(row.variants.default.cpsat.strictTargetProbe?.targetFeasibility, 'proved_infeasible', shortfallId);
  }
});

test('renderMarkdownReport derives pass counts dynamically on failed or unavailable runs', () => {
  const summaryPath = resolve(ROOT, 'docs/evidence/planner-heuristic-vs-cpsat-2026-11-25/summary.json');
  const synthetic = JSON.parse(readFileSync(summaryPath, 'utf8'));
  synthetic.cases[0].variants.default.heuristic.findings = ['synthetic_violation'];
  synthetic.cases[0].variants.default.cpsat.status = 'UNAVAILABLE';
  synthetic.cases[0].variants.default.cpsat.findings = [];

  const md = renderMarkdownReport(synthetic);
  assert.doesNotMatch(md, /100% pass rate/);
  assert.match(md, /1 unavailable\/errored/);
});
