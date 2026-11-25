# Issue #45 Evidence: Corrected Heuristic vs CP-SAT Planning

> **Status:** Experimental comparison (`#45` under `#13`). Produces inspectable benchmark evidence and a planner-selection decision question; **does not select or adopt a product planner** without explicit human review.

## 1. Environment, Pinned Versions & Integrity

- **Node:** `v24.11.1`
- **Python:** `3.13.16` (`experiments/planner-comparison/.venv/bin/python`)
- **OR-Tools:** `ortools==9.14.6206`
- **CP-SAT Settings:** `num_search_workers=1`, `random_seed=0`, `max_time_in_seconds=5`, host timeout `15000ms`, `repeats=3`
- **Artifact SHA-256 Hashes:**
  - `src/domain/planner.mjs`: `48cf77510dc14c42e8e92ddc784f21c1e1c7670268de3c79f0c83f272b581715`
  - `experiments/planner-comparison/cpsat_planner.py`: `e10f03b60bd36793afd0f6eb2e67c2f332ceac6f4ba52f269627e165b05741b1`
  - `experiments/planner-readiness/cases.json`: `410f75aecfd236f96c9f15a361607b90c076ed1be97ba91ae0afc1870a02181d`
  - `fixtures/calendars/bruno.json`: `8b9d8359aef47fff5794c36ba8696ee59c742bf6d89d656136e1b16c2c3106f1`
  - `fixtures/calendars/ana.json`: `d8b30692464396d7f1a02fc1291ce0a8c217ef4b5ed1d75d9d20e2035f0a7913`
  - `fixtures/paired-replay/bruno/case.json`: `00039caab6d88f06c56dc1bb93e601ab24b16d85e7bb3ec1a99792ea8afbc5c7`
  - `fixtures/paired-replay/ana-held-out/case.json`: `ee11252f4d1961396325e950aab4cfb771239659eec6d8eea87990e57dd7011b`

### Reproduce

```sh
cd experiments/planner-comparison && uv sync && cd ../..
experiments/planner-comparison/.venv/bin/python -m unittest discover -s experiments/planner-comparison/tests -p "test_*.py" -v
TMPDIR=/tmp ./node_modules/.bin/node --test --import ./tests/isolate-runtime.mjs tests/planner-comparison.test.mjs
TMPDIR=/tmp ./node_modules/.bin/node experiments/planner-comparison/benchmark.mjs --write-evidence docs/evidence/planner-heuristic-vs-cpsat-2026-11-25
```

## 2. Objective Disclosure & Feasibility Semantics

CP-SAT maximizes a **6-tier lexicographic integer objective** (disclosed explicitly so no hidden penalty trades away study minutes):

1. **Tier 1 — Total Scheduled Study Minutes (`W_BLOCK = 10,000,000` per 1h block):** Strictly larger than the worst-case marginal penalty of Tiers 2–6 (`<= 111,671`), guaranteeing CP-SAT **never** sacrifices feasible minutes for balance, daily spread, or period bonuses.
2. **Tier 2 — Preferred Period (`W_PREF_PERIOD = 200,000` per matching block):** Used only when `preferredPeriod` is supplied.
3. **Tier 3 — Distinct Eligible Course Coverage (`W_COVERAGE = 500,000` for `course-coverage`, `50,000` default, `10,000` with `focusCourse`):** Rewards covering every eligible course at least once without starving secondary courses when multiple blocks exist.
4. **Tier 4 — Horizon & Weekly Course Balance (`W_BALANCE = 20,000`):** Minimizes `max - min` spread across eligible courses (or deviation from ~2:1 target split when `focusCourse` is set).
5. **Tier 5 — Daily Spread (`W_DAILY_SPREAD = 1,000`):** Prefers spreading blocks across days over stacking multiple sessions on a single day.
6. **Tier 6 — Deterministic Canonical Tie-Breakers (`W_TIME = 1`, `W_COURSE_RANK = 1`):** Prefers earlier day/slot in week and orders ties by `(deadline, course.name)`, independent of input course array order.

**Status & Feasibility Semantics:**
- `OPTIMAL` + `target_met`: CP-SAT met 100% of every weekly target.
- `OPTIMAL` + `proved_shortfall`: CP-SAT proved no legal schedule can place more minutes under the reviewed windows, caps, breaks, commitments, and deadlines (cross-checked with `strictTarget: true` returning `INFEASIBLE`).
- `FEASIBLE`: legal schedule found within time cap, optimality not proved.
- `INFEASIBLE`: proved no legal schedule satisfies hard constraints (when `strictTarget: true`).
- `UNKNOWN` / `HOST_TIMEOUT`: time budget hit without proof; never treated as infeasibility.
- `UNAVAILABLE`: OR-Tools missing; never falls back to a heuristic.

## 3. Aggregate Summary (Core 10 Cases vs Diagnostic 2 Cases)

| Scope | Engine | Variants Passed `validateSchedule` | Deterministic | Total Scheduled / Target (min) | Avoidable Shortfall (min) | Multi-Course Default Coverage | Avg Multi-Course Imbalance | Median Latency (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Frozen (6 cases) | Heuristic (`planner.mjs`) | 12/12 | 12/12 | 8160 / 9120 | 0 | 2/5 | 396m | 1.204 |
| Frozen (6 cases) | CP-SAT (`ortools 9.14`) | 12/12 | 12/12 | 8160 / 9120 | 0 | 4/5 | 132m | 4.154 (in-proc) |
| Paired-Replay (4 cases) | Heuristic (`planner.mjs`) | 8/8 | 8/8 | 4320 / 4320 | 0 | 2/2 | 0m | 2.121 |
| Paired-Replay (4 cases) | CP-SAT (`ortools 9.14`) | 8/8 | 8/8 | 4320 / 4320 | 0 | 2/2 | 0m | 10.035 (in-proc) |
| Core Combined (10 cases) | Heuristic (`planner.mjs`) | 20/20 | 20/20 | 12480 / 13440 | 0 | 4/7 | 282.9m | 1.554 |
| Core Combined (10 cases) | CP-SAT (`ortools 9.14`) | 20/20 | 20/20 | 12480 / 13440 | 0 | 6/7 | 94.3m | 5.416 (in-proc) |
| Diagnostic Edge Cases (2 cases) | Heuristic (`planner.mjs`) | 2/2 | 2/2 | 60 / 240 | 60 | — | — | 0.036 |
| Diagnostic Edge Cases (2 cases) | CP-SAT (`ortools 9.14`) | 2/2 | 2/2 | 120 / 240 | 0 | — | — | 1.964 (in-proc) |

## 4. Per-Case Comparison

### 4.1 Frozen Readiness Cases (6 cases) & Paired-Replay Cases (4 cases)

| Case (Group) | Variant | Feasible Target (min) | Heuristic (min / courses / ms) | CP-SAT (min / courses / status / wall ms / round-trip ms) |
| --- | --- | ---: | --- | --- |
| `bruno-equal-cutoff` (frozen) | `default` | 1800m | 1800m / Banco de Dados: 1140m, Algoritmos: 660m / 6.436ms | 1800m / Banco de Dados: 900m, Algoritmos: 900m / OPTIMAL (target_met) / 93.267ms / 387.933ms |
| `bruno-equal-cutoff` (frozen) | `coverageOption` | 1800m | 1800m / Banco de Dados: 1140m, Algoritmos: 660m / 7.981ms | 1800m / Banco de Dados: 900m, Algoritmos: 900m / OPTIMAL (target_met) / 91.744ms / 384.134ms |
| `bruno-equal-cutoff` (frozen) | `reversedCourseOrder` | 1800m | 1800m / Banco de Dados: 660m, Algoritmos: 1140m / 7.455ms | 1800m / Banco de Dados: 900m, Algoritmos: 900m / OPTIMAL (target_met) / 101.191ms / 409.583ms |
| `ana-earlier-deadline` (frozen) | `default` | 240m | 240m / Machine Learning: 240m, Statistics: 0m / 1.043ms | 240m / Machine Learning: 120m, Statistics: 120m / OPTIMAL (target_met) / 5.616ms / 324.962ms |
| `ana-earlier-deadline` (frozen) | `coverageOption` | 240m | 240m / Machine Learning: 180m, Statistics: 60m / 0.85ms | 240m / Machine Learning: 120m, Statistics: 120m / OPTIMAL (target_met) / 5.337ms / 317.017ms |
| `bruno-explicit-priority` (frozen) | `default` | 1800m | 1800m / Banco de Dados: 360m, Algoritmos: 1440m / 9.099ms | 1800m / Banco de Dados: 600m, Algoritmos: 1200m / OPTIMAL (target_met) / 4113.753ms / 4401.154ms |
| `bruno-tight-capacity` (frozen) | `default` | 60m | 60m / Banco de Dados: 0m, Algoritmos: 60m / 0.703ms | 60m / Banco de Dados: 0m, Algoritmos: 60m / OPTIMAL (proved_shortfall) / 1.958ms / 295.813ms |
| `bruno-tight-capacity` (frozen) | `coverageOption` | 60m | 60m / Banco de Dados: 60m, Algoritmos: 0m / 0.687ms | 60m / Banco de Dados: 0m, Algoritmos: 60m / OPTIMAL (proved_shortfall) / 1.999ms / 297.361ms |
| `bruno-expired-course` (frozen) | `default` | 60m | 60m / Banco de Dados: 0m, Algoritmos: 60m / 1.366ms | 60m / Banco de Dados: 0m, Algoritmos: 60m / OPTIMAL (proved_shortfall) / 1.807ms / 294.469ms |
| `bruno-expired-course` (frozen) | `coverageOption` | 60m | 60m / Banco de Dados: 0m, Algoritmos: 60m / 1.689ms | 60m / Banco de Dados: 0m, Algoritmos: 60m / OPTIMAL (proved_shortfall) / 1.784ms / 307.033ms |
| `ravi-shift-exception` (frozen, held-out) | `default` | 120m | 120m / Writing: 120m, Quantitative reasoning: 0m / 0.144ms | 120m / Writing: 60m, Quantitative reasoning: 60m / OPTIMAL (proved_shortfall) / 2.85ms / 296.487ms |
| `ravi-shift-exception` (frozen, held-out) | `coverageOption` | 120m | 120m / Writing: 60m, Quantitative reasoning: 60m / 0.201ms | 120m / Writing: 60m, Quantitative reasoning: 60m / OPTIMAL (proved_shortfall) / 2.97ms / 292.02ms |
| `bruno-replay-initial` (paired-replay) | `default` | 600m | 600m / Algoritmos: 300m, Banco de Dados: 300m / 2.635ms | 600m / Algoritmos: 300m, Banco de Dados: 300m / OPTIMAL (target_met) / 15.194ms / 308.142ms |
| `bruno-replay-initial` (paired-replay) | `coverageOption` | 600m | 600m / Algoritmos: 240m, Banco de Dados: 360m / 2.544ms | 600m / Algoritmos: 300m, Banco de Dados: 300m / OPTIMAL (target_met) / 14.575ms / 305.805ms |
| `bruno-replay-post-correction` (paired-replay) | `default` | 600m | 600m / Algoritmos: 300m, Banco de Dados: 300m / 3.064ms | 600m / Algoritmos: 300m, Banco de Dados: 300m / OPTIMAL (target_met) / 15.536ms / 312.771ms |
| `bruno-replay-post-correction` (paired-replay) | `coverageOption` | 600m | 600m / Algoritmos: 300m, Banco de Dados: 300m / 2.588ms | 600m / Algoritmos: 300m, Banco de Dados: 300m / OPTIMAL (target_met) / 15.166ms / 305.106ms |
| `ana-held-out-initial` (paired-replay, held-out) | `default` | 480m | 480m / Applied Data Ethics: 480m / 1.203ms | 480m / Applied Data Ethics: 480m / OPTIMAL (target_met) / 5ms / 299.759ms |
| `ana-held-out-initial` (paired-replay, held-out) | `coverageOption` | 480m | 480m / Applied Data Ethics: 480m / 1.197ms | 480m / Applied Data Ethics: 480m / OPTIMAL (target_met) / 5.008ms / 295.661ms |
| `ana-held-out-post-correction` (paired-replay, held-out) | `default` | 480m | 480m / Applied Data Ethics: 480m / 1.698ms | 480m / Applied Data Ethics: 480m / OPTIMAL (target_met) / 5.495ms / 296.615ms |
| `ana-held-out-post-correction` (paired-replay, held-out) | `coverageOption` | 480m | 480m / Applied Data Ethics: 480m / 1.42ms | 480m / Applied Data Ethics: 480m / OPTIMAL (target_met) / 5.315ms / 298.447ms |

### 4.2 Diagnostic Edge Cases (Reported Separately)

| Case | Known Feasible (min) | Heuristic (min / shortfall / ms) | CP-SAT (min / status / strictTarget probe / wall ms) |
| --- | ---: | --- | --- |
| `preferred-period-boundary-packing` | 120m | 60m / avoidable 60m / 0.033ms | 120m / OPTIMAL (target_met) / — / 2.666ms |
| `zero-capacity-infeasible-target` | 0m | 0m / avoidable 0m / 0.038ms | 0m / OPTIMAL (proved_shortfall) / strictTarget=INFEASIBLE / 1.263ms |

### 4.3 Input-Order Sensitivity (`bruno-equal-cutoff`)

- **Heuristic (`src/domain/planner.mjs`):** `default` = Banco de Dados: 1140m, Algoritmos: 660m → `reversedCourseOrder` = Banco de Dados: 660m, Algoritmos: 1140m (**Order invariant:** `false` — flips by 480 minutes / 8 hours based purely on JSON array order).
- **CP-SAT (`cpsat_planner.py`):** `default` = Banco de Dados: 900m, Algoritmos: 900m → `reversedCourseOrder` = Banco de Dados: 900m, Algoritmos: 900m (**Order invariant:** `true` — identical split and identical blocks).

### 4.4 Strict-Target Infeasibility Proofs (`strictTarget: true`)

| Case | Target (min) | Known Feasible (min) | Default CP-SAT (`<= target`) | Strict-Target Probe (`== target`) |
| --- | ---: | ---: | --- | --- |
| `bruno-tight-capacity` | 240m | 60m | `OPTIMAL` (`proved_shortfall`, 60m) | `INFEASIBLE` (`proved_infeasible`) |
| `bruno-expired-course` | 240m | 60m | `OPTIMAL` (`proved_shortfall`, 60m) | `INFEASIBLE` (`proved_infeasible`) |
| `ravi-shift-exception` | 240m | 120m | `OPTIMAL` (`proved_shortfall`, 120m) | `INFEASIBLE` (`proved_infeasible`) |
| `zero-capacity-infeasible-target` | 120m | 0m | `OPTIMAL` (`proved_shortfall`, 0m) | `INFEASIBLE` (`proved_infeasible`) |

## 5. Representative Paired Schedules (For Human Selection Review)

### `ana-earlier-deadline`
- **Heuristic:** near `2026-11-04T14:00`–`15:00` (Machine Learning); near `2026-11-04T15:15`–`16:15` (Machine Learning); near `2026-11-06T14:00`–`15:00` (Machine Learning); near `2026-11-06T15:15`–`16:15` (Machine Learning)
- **CP-SAT:** near `2026-11-04T14:00`–`15:00` (Machine Learning); near `2026-11-04T15:15`–`16:15` (Statistics); near `2026-11-06T14:00`–`15:00` (Statistics); near `2026-11-06T15:15`–`16:15` (Machine Learning)

### `ravi-shift-exception`
- **Heuristic:** near `2026-11-05T20:00`–`21:00` (Writing); near `2026-11-08T15:00`–`16:00` (Writing)
- **CP-SAT:** near `2026-11-05T20:00`–`21:00` (Quantitative reasoning); near `2026-11-08T15:00`–`16:00` (Writing)

### `bruno-replay-post-correction`
- **Heuristic:** near `2026-11-04T19:00`–`20:00` (Algoritmos); near `2026-11-04T20:15`–`21:15` (Algoritmos); near `2026-11-07T14:00`–`15:00` (Banco de Dados); near `2026-11-07T15:15`–`16:15` (Banco de Dados); near `2026-11-08T10:00`–`11:00` (Algoritmos); future `2026-11-11T20:00`–`21:00` (Banco de Dados); future `2026-11-14T14:00`–`15:00` (Algoritmos); future `2026-11-14T15:15`–`16:15` (Algoritmos); future `2026-11-15T10:00`–`11:00` (Banco de Dados); future `2026-11-15T11:15`–`12:15` (Banco de Dados)
- **CP-SAT:** near `2026-11-04T19:00`–`20:00` (Algoritmos); near `2026-11-04T20:15`–`21:15` (Algoritmos); near `2026-11-07T14:00`–`15:00` (Banco de Dados); near `2026-11-07T15:15`–`16:15` (Banco de Dados); near `2026-11-08T10:00`–`11:00` (Algoritmos); future `2026-11-11T20:00`–`21:00` (Algoritmos); future `2026-11-14T14:00`–`15:00` (Algoritmos); future `2026-11-14T15:15`–`16:15` (Banco de Dados); future `2026-11-15T10:00`–`11:00` (Banco de Dados); future `2026-11-15T11:15`–`12:15` (Banco de Dados)

### `ana-held-out-post-correction`
- **Heuristic:** near `2026-11-05T14:00`–`15:00` (Applied Data Ethics); near `2026-11-05T15:15`–`16:15` (Applied Data Ethics); near `2026-11-06T14:00`–`15:00` (Applied Data Ethics); near `2026-11-06T15:15`–`16:15` (Applied Data Ethics); future `2026-11-11T15:00`–`16:00` (Applied Data Ethics); future `2026-11-12T14:00`–`15:00` (Applied Data Ethics); future `2026-11-12T15:15`–`16:15` (Applied Data Ethics); future `2026-11-13T14:00`–`15:00` (Applied Data Ethics)
- **CP-SAT:** near `2026-11-05T14:00`–`15:00` (Applied Data Ethics); near `2026-11-05T15:15`–`16:15` (Applied Data Ethics); near `2026-11-06T14:00`–`15:00` (Applied Data Ethics); near `2026-11-06T15:15`–`16:15` (Applied Data Ethics); future `2026-11-11T15:00`–`16:00` (Applied Data Ethics); future `2026-11-12T14:00`–`15:00` (Applied Data Ethics); future `2026-11-12T15:15`–`16:15` (Applied Data Ethics); future `2026-11-13T14:00`–`15:00` (Applied Data Ethics)

### `preferred-period-boundary-packing`
- **Heuristic:** near `2026-11-04T12:00`–`13:00` (Calculus)
- **CP-SAT:** near `2026-11-04T11:00`–`12:00` (Calculus); near `2026-11-04T12:15`–`13:15` (Calculus)

## 6. Complexity, Runtime & Dependency Tradeoff

- **Hard-Constraint Safety:** Both Heuristic (`src/domain/planner.mjs`) and CP-SAT achieved **100% pass rate** (`0` `validateSchedule` findings) across all 22 variants (20 core + 2 diagnostic).
- **Where Heuristic Struggles vs Where CP-SAT Wins:**
  1. **Equal-deadline input-order sensitivity (`bruno-equal-cutoff`):** Heuristic swings 1140m/660m ↔ 660m/1140m (8h shift) when `courses` is reversed; CP-SAT achieves an exact 900m/900m split invariant to input order.
  2. **Multi-course starvation (`ana-earlier-deadline`, `ravi-shift-exception`):** Without `allocation: "course-coverage"`, Heuristic puts 100% of blocks on the first course (`Machine Learning: 240m / Statistics: 0m` for Ana; `Writing: 120m / Quantitative reasoning: 0m` for Ravi). CP-SAT automatically balances (`120m/120m` for Ana, `60m/60m` for Ravi) while still honoring `focusCourse` (`1200m/600m` 2:1 split on `bruno-explicit-priority`).
  3. **Avoidable shortfall under `preferredPeriod` (`preferred-period-boundary-packing`):** Greedy slot sorting can lose a feasible block (60m vs 120m feasible) when a preferred-period slot straddles a break boundary; CP-SAT maximizes scheduled hours first (120m, 0 shortfall).
  4. **Optimality & infeasibility proof:** CP-SAT distinguishes `proved_shortfall` (`OPTIMAL` + `INFEASIBLE` under `strictTarget`) from timeouts.
- **Dependency & Latency Cost:**
  - `src/domain/planner.mjs` is ~230 lines of zero-dependency synchronous JavaScript running in **0.033–9.099 ms** (median per variant) inside Node.
  - CP-SAT requires Python + `ortools==9.14.6206` (native C++ binaries + `numpy`/`pandas`/`protobuf`, peak RSS **94.3–104.6 MiB**, **1.263–101.191 ms** in-process across 21/22 variants; `bruno-explicit-priority` reached **4113.753 ms** due to `focusCourse` 2:1 symmetry exploration near the 5s single-worker limit; **292.0–4401.2 ms** cold subprocess round-trip per call).

## 7. Headline Recommendation (For User Decision Gate)

**Do NOT bundle OR-Tools into the Node runtime yet.** Keep `src/domain/planner.mjs` as the lightweight default planner and consider one of two clean paths at the `#45` review gate:
1. **Port CP-SAT’s objective lessons into `src/domain/planner.mjs` (recommended if staying Node-native):** Canonicalize course tie-breaking by `(deadline, name)` (eliminates the 8h order swing), adopt balanced multi-course rotation / soft coverage when `focusCourse` is absent, and keep `preferredPeriod` as a secondary tie-breaker or run a two-pass / bounded local swap so period preference never causes avoidable shortfall.
2. **Adopt CP-SAT as an optional Python domain service:** Only worthwhile if future requirements introduce coupled cross-day dependencies, variable-length/splittable tasks, or larger multi-constraint schedules where greedy + swap cannot guarantee optimality.

## 8. Limitations

- All fixtures (`bruno`, `ana`, `ravi`) are synthetic calendars and course deadlines.
- Conflict-free schedule satisfaction (`validateSchedule` passing) does **not** establish personal student feasibility, cognitive sustainability, or learning benefit.
- Diagnostic edge cases (`preferred-period-boundary-packing`, `zero-capacity-infeasible-target`) were constructed specifically to isolate boundary/infeasibility behavior and are excluded from the core 10-case aggregate.
