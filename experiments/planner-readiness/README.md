# Frozen scheduling cases for #42 and #45

Run the existing planner on the pinned inputs with Node 24 and project dependencies installed.

    ./node_modules/.bin/node experiments/planner-readiness/baseline.mjs
    ./node_modules/.bin/node --test tests/planner-readiness.test.mjs

The only inputs are fixtures. The runner makes no model calls and starts no calendar service. Case bytes and referenced calendars have SHA-256 identities. Bruno and Ana use the checked-in synthetic calendars. Ravi has a small new calendar and stays out of candidate tuning until the comparison settings are frozen. The main baseline was pinned before recording results. The paired run will pin both adapter revisions separately.

## Shared constraints and measures

- Same fixed São Paulo clock, 15-minute start grid, one-hour sessions, requested weeks, permitted windows and excluded dates. Preserve all-day events and exact half-open boundaries. Track existing commitments, deadlines, daily caps, breaks and weekly target as separate checks.
- Measure omissions against weekly demand, then report per-course minutes, course priority, spacing and feasible alternatives separately. A short schedule can be legal and still miss an achievable target. The stored feasible-minute counts are witnessed by independent validation of a baseline plan. Deadline and tight-capacity cases have an explicit reason for shortfall.
- For Bruno’s equal cutoff, compare original and reversed course order. Favor roughly equal horizon time when workload and priority are unknown. Treat equal allocation as a preference whose tradeoffs should be explained. For Ana, show whether concentrating on the earlier assessment costs all coverage of Statistics. For explicit priority, measure whether the priority changes the distribution and label the competing tradeoff.
- Freeze the scoring order before tuning on these cases. Proposed first pass ranks hard legality, fulfilled minutes, then documented preference and coverage goals. Report justified coverage differences, wall time and actual status alongside scores. Review concise explanations against the real schedule times and weekly totals.

## First comparison setup

Use the actual product heuristic as the reference and a CP-SAT adapter with the same profile and constraints. Retain the old toy solver and fixture results as calibration evidence. Their 30-minute grid and indivisible tasks answer different questions. Copy reusable pieces only after checking 15-minute breaks, fixed windows, tighter horizons and the common acceptance rules. For a first constrained run, use one solver worker with a fixed seed, up to five seconds solver time per case, and a host-enforced 15-second per-case timeout. Record library versions and actual resource use. Distinguish unavailable, timeout or unknown, proved infeasible and feasible results. Fix the CP-SAT dependency version before the first paired run.

The current policy and its coverage option are both recorded for review. The validation and common report can be reused in the paired comparison. The experiments use synthetic cases. Generalization, agent question behavior and human experience each have separate evidence.
