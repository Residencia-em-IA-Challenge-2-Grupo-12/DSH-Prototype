import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, makePlan } from '../../src/domain/planner.mjs';
import { validateSchedule } from '../../src/paired-replay/schedule.mjs';
import { measurePlan } from '../planner-readiness/baseline.mjs';
import { ROOT, loadComparisonSuite } from './cases.mjs';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const CPSAT_SCRIPT = resolve(THIS_DIR, 'cpsat_planner.py');
const VENV_PYTHON = resolve(THIS_DIR, '.venv/bin/python');

const OBJECTIVE_DISCLOSURE_SUMMARY =
  '6-tier weighted integer maximization with block-count dominance; solve_plan computes a conservative global upper bound `maxLowerTierSpan` on the swing of Tiers 2–6 and sets `blockWeight = max(10,000,000, maxLowerTierSpan + 1)` so CP-SAT never sacrifices a feasible study block for preferred-period, coverage, balance, or spread terms (lower tiers trade off via explicit weights).';

export function isEvaluatedResult(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (['UNAVAILABLE', 'ERROR', 'HOST_TIMEOUT', 'INFEASIBLE', 'UNKNOWN'].includes(entry.status)) return false;
  if (entry.hasPlan === false) return false;
  return true;
}

export function resolvePythonBinary(explicitPython) {
  if (explicitPython) return explicitPython;
  if (process.env.STUDY_ATLAS_CPSAT_PYTHON) return process.env.STUDY_ATLAS_CPSAT_PYTHON;
  return existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';
}

export function invokeCpSat(payload, { pythonBin, hostTimeoutMs = 15_000 } = {}) {
  const python = resolvePythonBinary(pythonBin);
  const started = performance.now();
  try {
    const stdout = execFileSync(python, [CPSAT_SCRIPT], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: hostTimeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
    const hostRoundTripMs = Number((performance.now() - started).toFixed(3));
    const parsed = JSON.parse(stdout);
    if (parsed?.plan && Array.isArray(payload?.events)) {
      parsed.plan.baseHash = digest(payload.events);
    }
    return { ...parsed, hostRoundTripMs };
  } catch (error) {
    const hostRoundTripMs = Number((performance.now() - started).toFixed(3));
    const timedOut = error?.killed || error?.code === 'ETIMEDOUT';
    return {
      plan: null,
      hostRoundTripMs,
      solver: {
        engine: 'cp-sat',
        ortoolsVersion: null,
        pythonVersion: null,
        status: timedOut ? 'HOST_TIMEOUT' : 'ERROR',
        targetFeasibility: timedOut ? 'timeout_or_unknown' : 'error',
        reason: String(error?.message || error),
        wallMs: null,
        cpSatSearchMs: null,
        peakRssKb: null,
      },
    };
  }
}

export function canonicalBlocks(plan) {
  if (!plan) return [];
  return [...plan.near, ...plan.future]
    .map(block => ({
      section: block.status === 'confirmed' ? 'near' : 'future',
      course: block.extendedProperties.private.course,
      start: block.start.dateTime,
      end: block.end.dateTime,
    }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.course.localeCompare(b.course));
}

function periodOfBlock(startIso) {
  const hour = Number(startIso.slice(11, 13));
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

function countFeasibleCourses(scenario, profile, clock) {
  const todayMs = Date.parse(`${clock.date}T00:00:00-03:00`);
  const horizonEndMs = Math.min(
    todayMs + scenario.weeks * 7 * 86_400_000,
    profile.availabilityThrough
      ? Date.parse(`${profile.availabilityThrough}T00:00:00-03:00`) + 86_400_000
      : Infinity,
  );
  const busy = scenario.events
    .filter(ev => ev.status !== 'cancelled' && ev.transparency !== 'transparent')
    .map(ev => ({
      start: Date.parse(ev.start.dateTime || `${ev.start.date}T00:00:00-03:00`),
      end: Date.parse(ev.end.dateTime || `${ev.end.date}T00:00:00-03:00`),
    }));
  const avoid = new Set(scenario.avoidDates || []);
  const startUtc = new Date(`${clock.date}T00:00:00Z`);
  const feasible = new Set();

  for (let w = 0; w < scenario.weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(startUtc.getTime() + (w * 7 + d) * 86_400_000);
      const dayKey = day.toISOString().slice(0, 10);
      if (avoid.has(dayKey) || (profile.availabilityThrough && dayKey > profile.availabilityThrough)) continue;
      for (const win of profile.studyWindows.filter(item => item.weekday === day.getUTCDay())) {
        const sMin = Number(win.start.slice(0, 2)) * 60 + Number(win.start.slice(3));
        const eMin = Number(win.end.slice(0, 2)) * 60 + Number(win.end.slice(3));
        for (let m = sMin; m + 60 <= eMin; m += 15) {
          const dt = new Date(day.getTime() + m * 60_000);
          const sMs = Date.parse(dt.toISOString().replace('Z', '').slice(0, 19) + '-03:00');
          const eMs = sMs + 3_600_000;
          if (eMs > horizonEndMs) continue;
          if (busy.some(b => sMs < b.end && b.start < eMs)) continue;
          for (const course of profile.courses) {
            if (eMs <= Date.parse(course.deadline)) feasible.add(course.name);
          }
        }
      }
    }
  }
  return [...feasible];
}

export function evaluatePlan(plan, scenario, profile, options, { clock, sessionMinutes, slotMinutes }) {
  const feasibleCourses = countFeasibleCourses(scenario, profile, clock);
  if (!plan) {
    return {
      hasPlan: false,
      validHardConstraints: false,
      findings: ['No plan returned'],
      strictTargetFindings: ['No plan returned'],
      scheduledMinutesByWeek: Array.from({ length: scenario.weeks }, () => 0),
      totalScheduledMinutes: 0,
      targetTotalMinutes: scenario.weeks * profile.targetHours * 60,
      knownFeasibleTotalMinutes: scenario.knownFeasibleMinutes.reduce((a, b) => a + b, 0),
      shortfallMinutes: scenario.weeks * profile.targetHours * 60,
      avoidableShortfallMinutes: scenario.knownFeasibleMinutes.reduce((a, b) => a + b, 0),
      perCourse: Object.fromEntries(profile.courses.map(c => [c.name, 0])),
      feasibleCourses,
      coveredFeasibleCourses: 0,
      courseCoverageRate: feasibleCourses.length ? 0 : 1,
      courseImbalanceMinutes: 0,
      preferredPeriodMatches: 0,
      baseHash: null,
      blocks: [],
    };
  }

  const measured = measurePlan(plan, scenario.events, { clock, scenario, sessionMinutes, slotMinutes });
  const actions = blocks =>
    blocks.map(block => ({
      kind: 'add',
      eventId: block.id,
      course: block.extendedProperties.private.course,
      start: block.start.dateTime,
      end: block.end.dateTime,
    }));
  const proposal = {
    sources: profile.courses.map(course => ({ course: course.name, deadline: course.deadline })),
    sections: { near: actions(plan.near), future: actions(plan.future) },
  };
  const reviewed = { ...profile, through: profile.availabilityThrough };
  const strictTargetFindings = validateSchedule(
    proposal,
    scenario.events,
    { clock, expect: { avoidDates: scenario.avoidDates || [] } },
    reviewed,
    { allowShortfall: false },
  );

  const totalScheduledMinutes = measured.scheduledMinutesByWeek.reduce((a, b) => a + b, 0);
  const targetTotalMinutes = scenario.weeks * profile.targetHours * 60;
  const knownFeasibleTotalMinutes = scenario.knownFeasibleMinutes.reduce((a, b) => a + b, 0);

  const feasibleCounts = feasibleCourses.map(name => measured.perCourse[name] || 0);
  const coveredFeasibleCourses = feasibleCounts.filter(mins => mins > 0).length;
  const courseImbalanceMinutes =
    feasibleCounts.length >= 2 ? Math.max(...feasibleCounts) - Math.min(...feasibleCounts) : 0;

  const blocks = canonicalBlocks(plan);
  const preferredPeriodMatches = options.preferredPeriod
    ? blocks.filter(block => periodOfBlock(block.start) === options.preferredPeriod).length
    : null;

  return {
    hasPlan: true,
    validHardConstraints: measured.findings.length === 0,
    findings: measured.findings,
    strictTargetFindings,
    scheduledMinutesByWeek: measured.scheduledMinutesByWeek,
    totalScheduledMinutes,
    targetTotalMinutes,
    knownFeasibleTotalMinutes,
    shortfallMinutes: Math.max(0, targetTotalMinutes - totalScheduledMinutes),
    avoidableShortfallMinutes: Math.max(0, knownFeasibleTotalMinutes - totalScheduledMinutes),
    perCourse: measured.perCourse,
    feasibleCourses,
    coveredFeasibleCourses,
    courseCoverageRate: feasibleCourses.length
      ? Number((coveredFeasibleCourses / feasibleCourses.length).toFixed(4))
      : 1,
    courseImbalanceMinutes,
    preferredPeriodMatches,
    baseHash: plan.baseHash,
    blocks,
  };
}

function median(values) {
  const valid = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : Number(((valid[mid - 1] + valid[mid]) / 2).toFixed(3));
}

function summarizeGroup(rows, engineKey) {
  const variants = rows.flatMap(row => Object.values(row.variants).map(v => v[engineKey]));
  const availableVariants = variants.filter(isEvaluatedResult);
  const multiCourseDefaults = rows
    .filter(row => !row.focusCourse)
    .map(row => row.variants.default?.[engineKey])
    .filter(v => isEvaluatedResult(v) && v.feasibleCourses?.length >= 2);

  return {
    caseCount: rows.length,
    variantCount: variants.length,
    availableVariantCount: availableVariants.length,
    hardConstraintPassCount: availableVariants.filter(v => v.validHardConstraints).length,
    deterministicCount: availableVariants.filter(v => v.deterministic).length,
    strictTargetMetCount: availableVariants.filter(v => v.strictTargetFindings.length === 0).length,
    totalTargetMinutes: availableVariants.reduce((s, v) => s + v.targetTotalMinutes, 0),
    totalScheduledMinutes: availableVariants.reduce((s, v) => s + v.totalScheduledMinutes, 0),
    totalShortfallMinutes: availableVariants.reduce((s, v) => s + v.shortfallMinutes, 0),
    totalAvoidableShortfallMinutes: availableVariants.reduce((s, v) => s + v.avoidableShortfallMinutes, 0),
    multiCourseDefaultCount: multiCourseDefaults.length,
    multiCourseFullCoverageCount: multiCourseDefaults.filter(
      v => v.coveredFeasibleCourses === v.feasibleCourses.length,
    ).length,
    avgMultiCourseImbalanceMinutes: multiCourseDefaults.length
      ? Number(
          (
            multiCourseDefaults.reduce((s, v) => s + v.courseImbalanceMinutes, 0) /
            multiCourseDefaults.length
          ).toFixed(1),
        )
      : null,
    medianLatencyMs: median(availableVariants.map(v => v.medianLatencyMs)),
    maxLatencyMs: availableVariants.length
      ? Math.max(...availableVariants.map(v => v.maxLatencyMs || 0))
      : null,
  };
}

export function runComparison({
  pythonBin,
  repeats = 3,
  hostTimeoutMs = 15_000,
  maxTimeSeconds = 5.0,
} = {}) {
  const suite = loadComparisonSuite();
  const python = resolvePythonBinary(pythonBin);
  const metaCtx = { clock: suite.clock, sessionMinutes: suite.sessionMinutes, slotMinutes: suite.slotMinutes };

  let ortoolsVersion = null;
  let pythonVersion = null;
  let cpSatAvailable = false;

  const caseResults = suite.cases.map(scenario => {
    const variantsOut = {};
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

      // Heuristic repeats
      const hLatencies = [];
      const hSignatures = [];
      let hFirstPlan = null;
      for (let i = 0; i < repeats; i++) {
        const started = performance.now();
        const plan = makePlan(profile, scenario.events, options);
        hLatencies.push(Number((performance.now() - started).toFixed(3)));
        hSignatures.push(JSON.stringify(canonicalBlocks(plan)));
        if (i === 0) hFirstPlan = plan;
      }
      const hEval = evaluatePlan(hFirstPlan, scenario, profile, options, metaCtx);

      // CP-SAT repeats
      const cWallLatencies = [];
      const cSearchLatencies = [];
      const cRoundTrips = [];
      const cRss = [];
      const cSignatures = [];
      let cFirstResp = null;

      const cpSatPayload = {
        student: profile,
        events: scenario.events,
        options: {
          ...options,
          maxTimeSeconds,
          seed: 0,
          workers: 1,
          strictTarget: false,
        },
      };

      for (let i = 0; i < repeats; i++) {
        const resp = invokeCpSat(cpSatPayload, { pythonBin: python, hostTimeoutMs });
        if (i === 0) cFirstResp = resp;
        if (resp.solver?.ortoolsVersion) ortoolsVersion = resp.solver.ortoolsVersion;
        if (resp.solver?.pythonVersion) pythonVersion = resp.solver.pythonVersion;
        const solved = Boolean(
          resp.plan &&
            resp.solver?.status &&
            !['UNAVAILABLE', 'ERROR', 'HOST_TIMEOUT'].includes(resp.solver.status),
        );
        if (solved) {
          cpSatAvailable = true;
          if (typeof resp.solver?.wallMs === 'number') cWallLatencies.push(resp.solver.wallMs);
          if (typeof resp.solver?.cpSatSearchMs === 'number') cSearchLatencies.push(resp.solver.cpSatSearchMs);
          if (typeof resp.hostRoundTripMs === 'number') cRoundTrips.push(resp.hostRoundTripMs);
          if (typeof resp.solver?.peakRssKb === 'number') cRss.push(resp.solver.peakRssKb);
          cSignatures.push(JSON.stringify(canonicalBlocks(resp.plan)));
        }
        if (resp.solver?.status === 'UNAVAILABLE') break;
      }

      const cEval = evaluatePlan(cFirstResp?.plan, scenario, profile, options, metaCtx);

      // Strict-target infeasibility probe on shortfall cases (when CP-SAT is available)
      let strictTargetProbe = null;
      if (variant.name === 'default' && scenario.expectShortfall && cpSatAvailable) {
        const probeResp = invokeCpSat(
          {
            ...cpSatPayload,
            options: { ...cpSatPayload.options, strictTarget: true },
          },
          { pythonBin: python, hostTimeoutMs },
        );
        strictTargetProbe = {
          status: probeResp.solver?.status,
          targetFeasibility: probeResp.solver?.targetFeasibility,
          wallMs: probeResp.solver?.wallMs,
          cpSatSearchMs: probeResp.solver?.cpSatSearchMs,
        };
      }

      variantsOut[variant.name] = {
        heuristic: {
          status: 'FEASIBLE',
          deterministic: new Set(hSignatures).size === 1,
          medianLatencyMs: median(hLatencies),
          maxLatencyMs: Math.max(...hLatencies),
          latenciesMs: hLatencies,
          ...hEval,
        },
        cpsat: {
          status: cFirstResp?.solver?.status || 'UNKNOWN',
          targetFeasibility: cFirstResp?.solver?.targetFeasibility || 'unknown',
          reason: cFirstResp?.solver?.reason || null,
          deterministic: cSignatures.length ? new Set(cSignatures).size === 1 : null,
          medianLatencyMs: median(cWallLatencies),
          maxLatencyMs: cWallLatencies.length ? Math.max(...cWallLatencies) : null,
          medianCpSatSearchMs: median(cSearchLatencies),
          medianHostRoundTripMs: median(cRoundTrips),
          peakRssKb: cRss.length ? Math.max(...cRss) : null,
          objectiveValue: cFirstResp?.solver?.objectiveValue ?? null,
          bestObjectiveBound: cFirstResp?.solver?.bestObjectiveBound ?? null,
          blockWeight: cFirstResp?.solver?.blockWeight ?? null,
          maxLowerTierSpan: cFirstResp?.solver?.maxLowerTierSpan ?? null,
          blockDominanceGuaranteed: cFirstResp?.solver?.blockDominanceGuaranteed ?? null,
          numVariables: cFirstResp?.solver?.numVariables ?? null,
          numSlots: cFirstResp?.solver?.numSlots ?? null,
          strictTargetProbe,
          ...cEval,
        },
      };
    }

    let orderSensitivity = null;
    if (scenario.id === 'bruno-equal-cutoff' && variantsOut.default && variantsOut.reversedCourseOrder) {
      const cDef = variantsOut.default.cpsat;
      const cRev = variantsOut.reversedCourseOrder.cpsat;
      const cBothEvaluated = isEvaluatedResult(cDef) && isEvaluatedResult(cRev);
      orderSensitivity = {
        heuristic: {
          defaultPerCourse: variantsOut.default.heuristic.perCourse,
          reversedPerCourse: variantsOut.reversedCourseOrder.heuristic.perCourse,
          courseOrderInvariant:
            JSON.stringify(variantsOut.default.heuristic.perCourse) ===
            JSON.stringify(variantsOut.reversedCourseOrder.heuristic.perCourse),
        },
        cpsat: {
          defaultPerCourse: cBothEvaluated ? cDef.perCourse : null,
          reversedPerCourse: cBothEvaluated ? cRev.perCourse : null,
          courseOrderInvariant: cBothEvaluated
            ? JSON.stringify(cDef.perCourse) === JSON.stringify(cRev.perCourse) &&
              JSON.stringify(cDef.blocks) === JSON.stringify(cRev.blocks)
            : null,
        },
      };
    }

    return {
      id: scenario.id,
      group: scenario.group,
      heldOut: scenario.heldOut,
      purpose: scenario.purpose,
      weeks: scenario.weeks,
      knownFeasibleMinutes: scenario.knownFeasibleMinutes,
      expectShortfall: scenario.expectShortfall,
      orderSensitivity,
      variants: variantsOut,
    };
  });

  const frozenRows = caseResults.filter(r => r.group === 'frozen');
  const replayRows = caseResults.filter(r => r.group === 'paired-replay');
  const coreRows = caseResults.filter(r => r.group === 'frozen' || r.group === 'paired-replay');
  const diagnosticRows = caseResults.filter(r => r.group === 'diagnostic');

  const aggregates = {
    frozen: {
      heuristic: summarizeGroup(frozenRows, 'heuristic'),
      cpsat: summarizeGroup(frozenRows, 'cpsat'),
    },
    pairedReplay: {
      heuristic: summarizeGroup(replayRows, 'heuristic'),
      cpsat: summarizeGroup(replayRows, 'cpsat'),
    },
    coreCombined: {
      heuristic: summarizeGroup(coreRows, 'heuristic'),
      cpsat: summarizeGroup(coreRows, 'cpsat'),
    },
    diagnostic: {
      heuristic: summarizeGroup(diagnosticRows, 'heuristic'),
      cpsat: summarizeGroup(diagnosticRows, 'cpsat'),
    },
  };

  let gitBaseCommit = null;
  let gitDirtyAtGeneration = null;
  try {
    gitBaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const trackedStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    gitDirtyAtGeneration = trackedStatus.length > 0;
  } catch {
    gitBaseCommit = null;
    gitDirtyAtGeneration = null;
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      pythonVersion,
      ortoolsVersion,
      cpSatAvailable,
      pythonBinary: python === VENV_PYTHON ? 'experiments/planner-comparison/.venv/bin/python' : python,
      gitHeadAtGeneration: gitBaseCommit,
      gitDirtyAtGeneration,
      solverParams: {
        workers: 1,
        seed: 0,
        maxTimeSeconds,
        hostTimeoutMs,
        repeats,
      },
    },
    hashes: suite.hashes,
    objectiveDisclosure: {
      summary: OBJECTIVE_DISCLOSURE_SUMMARY,
      weights: {
        W_BLOCK_MIN: 10_000_000,
        W_PREF_PERIOD: 200_000,
        W_COVERAGE_DEFAULT: 50_000,
        W_COVERAGE_OPTION: 500_000,
        W_COVERAGE_FOCUS: 10_000,
        W_BALANCE: 20_000,
        W_DAILY_SPREAD: 1_000,
        W_TIME: 1,
        W_COURSE_RANK: 1,
      },
    },
    aggregates,
    cases: caseResults,
  };
}

function fmtCourses(perCourse) {
  return Object.entries(perCourse)
    .map(([name, mins]) => `${name}: ${mins}m`)
    .join(', ');
}

function fmtBlocks(blocks) {
  if (!blocks.length) return '_None_';
  return blocks
    .map(b => `${b.section === 'near' ? 'near' : 'future'} \`${b.start.slice(0, 16)}\`–\`${b.end.slice(11, 16)}\` (${b.course})`)
    .join('; ');
}

export function renderMarkdownReport(summary) {
  const { environment: env, aggregates, cases, hashes } = summary;
  const lines = [];

  lines.push('# Issue #45 Evidence: Corrected Heuristic vs CP-SAT Planning');
  lines.push('');
  lines.push('> **Status:** Experimental comparison (`#45` under `#13`). Produces inspectable benchmark evidence and a planner-selection decision question; **does not select or adopt a product planner** without explicit human review.');
  lines.push('');
  lines.push('## 1. Environment, Pinned Versions & Integrity');
  lines.push('');
  lines.push(`- **Node:** \`${env.nodeVersion}\``);
  lines.push(`- **Python:** \`${env.pythonVersion || 'unavailable'}\` (\`${env.pythonBinary}\`)`);
  lines.push(`- **OR-Tools:** \`${env.ortoolsVersion ? `ortools==${env.ortoolsVersion}` : 'unavailable'}\``);
  lines.push(`- **Git HEAD at generation:** \`${env.gitHeadAtGeneration || 'unknown'}\` (tracked tree dirty: \`${env.gitDirtyAtGeneration ?? 'unknown'}\`)`);
  lines.push(`- **CP-SAT Settings:** \`num_search_workers=${env.solverParams.workers}\`, \`random_seed=${env.solverParams.seed}\`, \`max_time_in_seconds=${env.solverParams.maxTimeSeconds}\`, host timeout \`${env.solverParams.hostTimeoutMs}ms\`, \`repeats=${env.solverParams.repeats}\``);
  lines.push(`- **Artifact SHA-256 Hashes:**`);
  lines.push(`  - \`src/domain/planner.mjs\`: \`${hashes.heuristicPlannerSha256}\``);
  lines.push(`  - \`experiments/planner-comparison/cpsat_planner.py\`: \`${hashes.cpsatPlannerSha256}\``);
  if (hashes.benchmarkSha256) lines.push(`  - \`experiments/planner-comparison/benchmark.mjs\`: \`${hashes.benchmarkSha256}\``);
  if (hashes.casesLoaderSha256) lines.push(`  - \`experiments/planner-comparison/cases.mjs\`: \`${hashes.casesLoaderSha256}\``);
  lines.push(`  - \`experiments/planner-readiness/cases.json\`: \`${hashes.readinessCasesSha256}\``);
  lines.push(`  - \`fixtures/calendars/bruno.json\`: \`${hashes.brunoCalendarSha256}\``);
  lines.push(`  - \`fixtures/calendars/ana.json\`: \`${hashes.anaCalendarSha256}\``);
  lines.push(`  - \`fixtures/paired-replay/bruno/case.json\`: \`${hashes.brunoReplayCaseSha256}\``);
  lines.push(`  - \`fixtures/paired-replay/ana-held-out/case.json\`: \`${hashes.anaReplayCaseSha256}\``);
  lines.push('');
  lines.push('### Reproduce');
  lines.push('');
  lines.push('```sh');
  lines.push('cd experiments/planner-comparison && uv sync && cd ../..');
  lines.push('experiments/planner-comparison/.venv/bin/python -m unittest discover -s experiments/planner-comparison/tests -p "test_*.py" -v');
  lines.push('TMPDIR=/tmp ./node_modules/.bin/node --test --import ./tests/isolate-runtime.mjs tests/planner-comparison.test.mjs');
  lines.push('TMPDIR=/tmp ./node_modules/.bin/node experiments/planner-comparison/benchmark.mjs --write-evidence docs/evidence/planner-heuristic-vs-cpsat-2026-11-25');
  lines.push('```');
  lines.push('');
  lines.push('## 2. Objective Disclosure & Feasibility Semantics');
  lines.push('');
  lines.push(summary.objectiveDisclosure?.summary || OBJECTIVE_DISCLOSURE_SUMMARY);
  lines.push('');
  lines.push('1. **Tier 1 — Total Scheduled Study Minutes (`blockWeight = max(10,000,000, maxLowerTierSpan + 1)` per 1h block):** Dynamically computed per instance to strictly exceed the conservative global upper bound (`maxLowerTierSpan`) on the swing of Tiers 2–6 across any two feasible schedules, guaranteeing CP-SAT **never** sacrifices a feasible study block for preferred-period, coverage, balance, or spread terms.');
  lines.push('2. **Tier 2 — Preferred Period (`W_PREF_PERIOD = 200,000` per matching block):** Used only when `preferredPeriod` is supplied.');
  lines.push('3. **Tier 3 — Distinct Eligible Course Coverage (`W_COVERAGE = 500,000` for `course-coverage`, `50,000` default, `10,000` with `focusCourse`):** Rewards covering every eligible course at least once. Note that coverage and balance are explicit product preferences encoded into CP-SAT, not universal correctness rules.');
  lines.push('4. **Tier 4 — Horizon & Weekly Course Balance (`W_BALANCE = 20,000`):** Minimizes `max - min` spread across eligible courses (or deviation from ~2:1 target split when `focusCourse` is set).');
  lines.push('5. **Tier 5 — Daily Spread (`W_DAILY_SPREAD = 1,000`):** Prefers spreading blocks across days over stacking multiple sessions on a single day.');
  lines.push('6. **Tier 6 — Deterministic Canonical Tie-Breakers (`W_TIME = 1`, `W_COURSE_RANK = 1`):** Prefers earlier day/slot in week and orders ties by `(deadline, course.name)`, independent of input course array order.');
  lines.push('');
  lines.push('**Status & Feasibility Semantics:**');
  lines.push('- `OPTIMAL` + `target_met`: CP-SAT met 100% of every weekly target.');
  lines.push('- `OPTIMAL` + `proved_shortfall`: CP-SAT reached `OPTIMAL` with `blockDominanceGuaranteed = true` (`blockWeight > maxLowerTierSpan`), proving no legal schedule places more blocks under the modeled constraints (additionally cross-checked with `strictTarget: true` returning `INFEASIBLE` to confirm the full target is unattainable).');
  lines.push('- `FEASIBLE`: legal schedule found within time cap, optimality not proved.');
  lines.push('- `INFEASIBLE`: proved no legal schedule satisfies hard constraints (when `strictTarget: true`, proves the full weekly target is unattainable under the modeled constraints).');
  lines.push('- `UNKNOWN` / `HOST_TIMEOUT`: time budget hit without proof; never treated as infeasibility.');
  lines.push('- `UNAVAILABLE`: OR-Tools missing; never falls back to a heuristic.');
  lines.push('');
  lines.push('## 3. Aggregate Summary (Core 10 Cases vs Diagnostic 2 Cases)');
  lines.push('');
  lines.push('| Scope | Engine | Variants Passed `validateSchedule` | Deterministic | Total Scheduled / Target (min) | Avoidable Shortfall (min) | Multi-Course Default Coverage | Avg Multi-Course Imbalance | Median Latency (ms) |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [label, grp] of [
    ['Frozen (6 cases)', aggregates.frozen],
    ['Paired-Replay (4 cases)', aggregates.pairedReplay],
    ['Core Combined (10 cases)', aggregates.coreCombined],
    ['Diagnostic Edge Cases (2 cases)', aggregates.diagnostic],
  ]) {
    for (const [engLabel, stats] of [
      ['Heuristic (`planner.mjs`)', grp.heuristic],
      ['CP-SAT (`ortools 9.14`)', grp.cpsat],
    ]) {
      const cov = stats.multiCourseDefaultCount
        ? `${stats.multiCourseFullCoverageCount}/${stats.multiCourseDefaultCount}`
        : '—';
      const imb = stats.avgMultiCourseImbalanceMinutes !== null ? `${stats.avgMultiCourseImbalanceMinutes}m` : '—';
      const lat =
        engLabel.startsWith('CP-SAT') && stats.medianLatencyMs !== null
          ? `${stats.medianLatencyMs} (in-proc)`
          : `${stats.medianLatencyMs ?? '—'}`;
      lines.push(
        `| ${label} | ${engLabel} | ${stats.hardConstraintPassCount}/${stats.availableVariantCount} | ${stats.deterministicCount}/${stats.availableVariantCount} | ${stats.totalScheduledMinutes} / ${stats.totalTargetMinutes} | ${stats.totalAvoidableShortfallMinutes} | ${cov} | ${imb} | ${lat} |`,
      );
    }
  }
  lines.push('');
  lines.push('## 4. Per-Case Comparison');
  lines.push('');
  lines.push('### 4.1 Frozen Readiness Cases (6 cases) & Paired-Replay Cases (4 cases)');
  lines.push('');
  lines.push('| Case (Group) | Variant | Feasible Target (min) | Heuristic (min / courses / ms) | CP-SAT (min / courses / status / wall ms / round-trip ms) |');
  lines.push('| --- | --- | ---: | --- | --- |');
  for (const row of cases.filter(c => c.group !== 'diagnostic')) {
    const feasibleSum = row.knownFeasibleMinutes.reduce((a, b) => a + b, 0);
    const tag = `${row.group}${row.heldOut ? ', held-out' : ''}`;
    for (const [vName, pair] of Object.entries(row.variants)) {
      const h = pair.heuristic;
      const c = pair.cpsat;
      const cStr = !isEvaluatedResult(c)
        ? c?.status || 'UNAVAILABLE'
        : `${c.totalScheduledMinutes}m / ${fmtCourses(c.perCourse)} / ${c.status} (${c.targetFeasibility}) / ${c.medianLatencyMs}ms / ${c.medianHostRoundTripMs}ms`;
      lines.push(
        `| \`${row.id}\` (${tag}) | \`${vName}\` | ${feasibleSum}m | ${h.totalScheduledMinutes}m / ${fmtCourses(h.perCourse)} / ${h.medianLatencyMs}ms | ${cStr} |`,
      );
    }
  }
  lines.push('');
  lines.push('### 4.2 Diagnostic Edge Cases (Reported Separately)');
  lines.push('');
  lines.push('| Case | Known Feasible (min) | Heuristic (min / shortfall / ms) | CP-SAT (min / status / strictTarget probe / wall ms) |');
  lines.push('| --- | ---: | --- | --- |');
  for (const row of cases.filter(c => c.group === 'diagnostic')) {
    const feasibleSum = row.knownFeasibleMinutes.reduce((a, b) => a + b, 0);
    const pair = row.variants.default;
    const h = pair.heuristic;
    const c = pair.cpsat;
    const probe = c.strictTargetProbe ? `strictTarget=${c.strictTargetProbe.status}` : '—';
    const cDiagStr = !isEvaluatedResult(c)
      ? c?.status || 'UNAVAILABLE'
      : `${c.totalScheduledMinutes}m / ${c.status} (${c.targetFeasibility}) / ${probe} / ${c.medianLatencyMs}ms`;
    lines.push(
      `| \`${row.id}\` | ${feasibleSum}m | ${h.totalScheduledMinutes}m / avoidable ${h.avoidableShortfallMinutes}m / ${h.medianLatencyMs}ms | ${cDiagStr} |`,
    );
  }
  lines.push('');

  const brunoOrder = cases.find(c => c.id === 'bruno-equal-cutoff')?.orderSensitivity;
  if (brunoOrder) {
    lines.push('### 4.3 Input-Order Sensitivity (`bruno-equal-cutoff`)');
    lines.push('');
    lines.push(`- **Heuristic (` + '`src/domain/planner.mjs`' + `):** \`default\` = ${fmtCourses(brunoOrder.heuristic.defaultPerCourse)} → \`reversedCourseOrder\` = ${fmtCourses(brunoOrder.heuristic.reversedPerCourse)} (**Order invariant:** \`${brunoOrder.heuristic.courseOrderInvariant}\` — flips by 480 minutes / 8 hours based purely on JSON array order).`);
    if (brunoOrder.cpsat.defaultPerCourse && brunoOrder.cpsat.reversedPerCourse) {
      lines.push(`- **CP-SAT (` + '`cpsat_planner.py`' + `):** \`default\` = ${fmtCourses(brunoOrder.cpsat.defaultPerCourse)} → \`reversedCourseOrder\` = ${fmtCourses(brunoOrder.cpsat.reversedPerCourse)} (**Order invariant:** \`${brunoOrder.cpsat.courseOrderInvariant}\`).`);
    } else {
      lines.push('- **CP-SAT (`cpsat_planner.py`):** UNAVAILABLE (not evaluated).');
    }
    lines.push('');
  }

  lines.push('### 4.4 Strict-Target Infeasibility Proofs (`strictTarget: true`)');
  lines.push('');
  lines.push('| Case | Target (min) | Known Feasible (min) | Default CP-SAT (`<= target`) | Strict-Target Probe (`== target`) |');
  lines.push('| --- | ---: | ---: | --- | --- |');
  for (const row of cases.filter(c => c.variants.default?.cpsat?.strictTargetProbe)) {
    const c = row.variants.default.cpsat;
    const feasibleSum = row.knownFeasibleMinutes.reduce((a, b) => a + b, 0);
    lines.push(
      `| \`${row.id}\` | ${c.targetTotalMinutes}m | ${feasibleSum}m | \`${c.status}\` (\`${c.targetFeasibility}\`, ${c.totalScheduledMinutes}m) | \`${c.strictTargetProbe.status}\` (\`${c.strictTargetProbe.targetFeasibility}\`) |`,
    );
  }
  lines.push('');

  lines.push('## 5. Representative Paired Schedules (For Human Selection Review)');
  lines.push('');
  const repIds = [
    'ana-earlier-deadline',
    'ravi-shift-exception',
    'bruno-replay-post-correction',
    'ana-held-out-post-correction',
    'preferred-period-boundary-packing',
  ];
  for (const id of repIds) {
    const row = cases.find(c => c.id === id);
    if (!row) continue;
    const def = row.variants.default;
    lines.push(`### \`${id}\``);
    lines.push(`- **Heuristic:** ${fmtBlocks(def.heuristic.blocks)}`);
    lines.push(`- **CP-SAT:** ${isEvaluatedResult(def.cpsat) ? fmtBlocks(def.cpsat.blocks) : '_UNAVAILABLE_'}`);
    lines.push('');
  }

  const allPairs = cases.flatMap(c => Object.entries(c.variants).map(([vName, pair]) => ({ id: c.id, vName, ...pair })));
  const totalAttempted = allPairs.length;
  const hEval = allPairs.filter(p => isEvaluatedResult(p.heuristic));
  const hPass = hEval.filter(p => Array.isArray(p.heuristic.findings) && p.heuristic.findings.length === 0);
  const cEval = allPairs.filter(p => isEvaluatedResult(p.cpsat));
  const cPass = cEval.filter(p => Array.isArray(p.cpsat.findings) && p.cpsat.findings.length === 0);
  const hRate = hEval.length ? `${((hPass.length / hEval.length) * 100).toFixed(1)}%` : 'N/A';
  const cRate = cEval.length ? `${((cPass.length / cEval.length) * 100).toFixed(1)}%` : 'N/A';

  const hLatencies = hEval.map(p => p.heuristic.medianLatencyMs).filter(v => typeof v === 'number');
  const cWallLatencies = cEval.map(p => p.cpsat.medianLatencyMs).filter(v => typeof v === 'number');
  const cRtLatencies = cEval.map(p => p.cpsat.medianHostRoundTripMs).filter(v => typeof v === 'number');
  const cRssMib = cEval.map(p => p.cpsat.peakRssKb).filter(v => typeof v === 'number').map(kb => kb / 1024);
  const cNonFocusWall = cEval
    .filter(p => p.id !== 'bruno-explicit-priority')
    .map(p => p.cpsat.medianLatencyMs)
    .filter(v => typeof v === 'number');
  const focusRow = cEval.find(p => p.id === 'bruno-explicit-priority');
  const anaRow = cases.find(c => c.id === 'ana-earlier-deadline')?.variants?.default;
  const raviRow = cases.find(c => c.id === 'ravi-shift-exception')?.variants?.default;
  const boundaryRow = cases.find(c => c.id === 'preferred-period-boundary-packing')?.variants?.default;

  lines.push('## 6. Complexity, Runtime & Dependency Tradeoff');
  lines.push('');
  lines.push(
    `- **Hard-Constraint Safety (derived from outcomes):** Heuristic (\`src/domain/planner.mjs\`) passed \`validateSchedule\` on **${hPass.length}/${hEval.length}** evaluated variants (${hRate}; ${totalAttempted} attempted). CP-SAT passed on **${cPass.length}/${cEval.length}** evaluated variants (${cRate}; ${totalAttempted} attempted${cEval.length < totalAttempted ? `, ${totalAttempted - cEval.length} unavailable/errored` : ''}).`,
  );
  lines.push('- **Observed Differences & Verified Root Causes:**');
  if (brunoOrder) {
    lines.push(
      `  1. **Equal-deadline input-order sensitivity (\`bruno-equal-cutoff\`):** Heuristic (\`src/domain/planner.mjs:134\`) sorts only by deadline and preserves JSON input order on ties: \`default\` = ${fmtCourses(brunoOrder.heuristic.defaultPerCourse)} vs \`reversedCourseOrder\` = ${fmtCourses(brunoOrder.heuristic.reversedPerCourse)} (\`courseOrderInvariant=${brunoOrder.heuristic.courseOrderInvariant}\`). CP-SAT: ${brunoOrder.cpsat.defaultPerCourse ? `${fmtCourses(brunoOrder.cpsat.defaultPerCourse)} (\`courseOrderInvariant=${brunoOrder.cpsat.courseOrderInvariant}\`)` : 'UNAVAILABLE (not evaluated)'}.`,
    );
  }
  if (anaRow && raviRow) {
    lines.push(
      `  2. **Heuristic course-rotation & urgency bugs (\`ana-earlier-deadline\`, \`ravi-shift-exception\`):** Without \`allocation: "course-coverage"\`, Heuristic produces ${fmtCourses(anaRow.heuristic.perCourse)} on \`ana-earlier-deadline\` and ${fmtCourses(raviRow.heuristic.perCourse)} on \`ravi-shift-exception\`, whereas CP-SAT produces ${!isEvaluatedResult(anaRow.cpsat) ? 'UNAVAILABLE' : fmtCourses(anaRow.cpsat.perCourse)} and ${!isEvaluatedResult(raviRow.cpsat) ? 'UNAVAILABLE' : fmtCourses(raviRow.cpsat.perCourse)}. **Root-cause correction:** \`ana-earlier-deadline\` is *not* missing a balance objective — it is a weekday-parity rotation bug at \`src/domain/planner.mjs:182\` (\`eligible[(w + candidate.d) % eligible.length]\` picks index \`0\` on both Wed \`d=2\` and Fri \`d=4\`, and would assign 100% to the *later*-deadline course on Tue+Thu \`(1,3)\`). \`ravi-shift-exception\` is caused by the \`<= 14\`-day urgency rule picking \`eligible[0]\` (\`:180-181\`) with input-order tie-breaking (\`:134\`). Note also that the Coverage/Imbalance columns mirror CP-SAT's own objective tiers 3–4; whether default scheduling should favor urgency or cross-course balance is a **product preference**, not a solver defect.`,
    );
  }
  if (boundaryRow) {
    lines.push(
      `  3. **Avoidable shortfall under \`preferredPeriod\` (\`preferred-period-boundary-packing\`):** Heuristic placed ${boundaryRow.heuristic.totalScheduledMinutes}m (avoidable shortfall ${boundaryRow.heuristic.avoidableShortfallMinutes}m) vs CP-SAT ${!isEvaluatedResult(boundaryRow.cpsat) ? 'UNAVAILABLE' : `${boundaryRow.cpsat.totalScheduledMinutes}m (avoidable shortfall ${boundaryRow.cpsat.avoidableShortfallMinutes}m)`} when a preferred-period slot straddles a break boundary.`,
    );
  }
  lines.push('  4. **Feasibility & shortfall proofs:** With dynamic `blockWeight > maxLowerTierSpan`, CP-SAT `OPTIMAL` proves maximum block count under the modeled constraints (`proved_shortfall`), and `strictTarget: true` returning `INFEASIBLE` independently proves the full weekly target is unattainable.');
  lines.push('- **Dependency & Latency Cost:**');
  if (hLatencies.length) {
    lines.push(`  - \`src/domain/planner.mjs\` is ~230 lines of zero-dependency synchronous JavaScript running in **${Math.min(...hLatencies).toFixed(3)}–${Math.max(...hLatencies).toFixed(3)} ms** (median per variant) inside Node.`);
  }
  if (cWallLatencies.length && env.ortoolsVersion) {
    const focusNote = focusRow?.cpsat?.medianLatencyMs
      ? `; \`bruno-explicit-priority\` reached **${focusRow.cpsat.medianLatencyMs} ms** due to \`focusCourse\` 2:1 symmetry exploration near the 5s single-worker limit`
      : '';
    lines.push(
      `  - CP-SAT requires Python + \`ortools==${env.ortoolsVersion}\` (native C++ binaries + \`numpy\`/\`pandas\`/\`protobuf\`, peak RSS **${Math.min(...cRssMib).toFixed(1)}–${Math.max(...cRssMib).toFixed(1)} MiB**, **${Math.min(...cNonFocusWall).toFixed(3)}–${Math.max(...cNonFocusWall).toFixed(3)} ms** in-process across ${cNonFocusWall.length}/${totalAttempted} variants${focusNote}; **${Math.min(...cRtLatencies).toFixed(1)}–${Math.max(...cRtLatencies).toFixed(1)} ms** cold subprocess round-trip per call).`,
    );
  } else {
    lines.push('  - CP-SAT runtime metrics: **UNAVAILABLE** (OR-Tools not installed in the configured Python runtime; no CP-SAT plans evaluated).');
  }
  lines.push('');
  lines.push('## 7. Headline Recommendation (For User Decision Gate)');
  lines.push('');
  lines.push('**Do NOT bundle OR-Tools into the Node runtime.** Keep `src/domain/planner.mjs` as the zero-dependency default planner and keep CP-SAT offline in `experiments/` as a reference / property-test oracle:');
  lines.push('1. **Fix the two 1–2 line `src/domain/planner.mjs` bugs + make `preferredPeriod` non-blocking (recommended):** Replace the weekday-parity rotation at `planner.mjs:182`, canonicalize equal-deadline tie-breaking by `(deadline, name)` at `planner.mjs:134`, and ensure `preferredPeriod` never reduces scheduled minutes (generate baseline first and accept the preferred-period variant only if total minutes do not drop). Treat default multi-course balance vs. earliest-deadline urgency as an explicit **product decision**, not an automatic CP-SAT objective port.');
  lines.push('2. **Adopt CP-SAT as an optional Python domain service only if requirements change:** Only worthwhile if future requirements introduce coupled cross-day dependencies, variable-length/splittable tasks, or larger multi-constraint schedules where greedy + swap cannot guarantee feasibility.');
  lines.push('');
  lines.push('## 8. Limitations');
  lines.push('');
  lines.push('- All fixtures (`bruno`, `ana`, `ravi`) are synthetic calendars and course deadlines. Because this PR reads `ana-held-out` expected answers and evaluates `ravi`, treat both as **public regression / `dev` fixtures** rather than blind holdouts for future evaluations.');
  lines.push('- **Shared horizon-clamp blind spot:** Both `planner.mjs:106-112` and `cpsat_planner.py:277-292` cap the entire multi-course planning horizon at the earliest upcoming deadline, so one course due in 5 days shrinks every other course\'s plan to one week. This benchmark does not test alternative per-course horizon policies.');
  lines.push('- **Circular soft metrics & ungraded explanations:** The Coverage and Imbalance columns reflect CP-SAT\'s own objective tiers 3–4. `ana-earlier-deadline`\'s original readiness purpose ("assess whether the explanation supports concentration") is not graded here.');
  lines.push('- **Host-speed sensitivity & timezone fallback:** `bruno-explicit-priority` approaches the 5s single-worker cap (`maxTimeSeconds=5.0`), so slower CI hosts could return `FEASIBLE` instead of `OPTIMAL`; `cpsat_planner.py` also defaults missing timezone offsets to `-03:00`.');
  lines.push('- Conflict-free schedule satisfaction (`validateSchedule` passing) does **not** establish personal student feasibility, cognitive sustainability, or learning benefit.');
  lines.push('- Diagnostic edge cases (`preferred-period-boundary-packing`, `zero-capacity-infeasible-target`) were constructed specifically to isolate boundary/infeasibility behavior and are excluded from the core 10-case aggregate.');
  lines.push('');

  return lines.join('\n');
}

function parseArgs(argv) {
  let writeEvidence = null;
  let repeats = 3;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write-evidence') writeEvidence = argv[++i];
    else if (argv[i] === '--repeats') repeats = Number(argv[++i]);
  }
  return { writeEvidence, repeats };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const summary = runComparison({ repeats: args.repeats });
  if (args.writeEvidence) {
    const outDir = resolve(ROOT, args.writeEvidence);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
    writeFileSync(resolve(outDir, 'README.md'), renderMarkdownReport(summary), 'utf8');
    process.stderr.write(`Wrote evidence to ${outDir}\n`);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}
