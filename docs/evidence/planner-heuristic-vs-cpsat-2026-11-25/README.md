# Issue #45 Evidence: Corrected Heuristic vs CP-SAT Planning

> **Status:** Experimental comparison (`#45` under `#13`). Produces inspectable benchmark evidence and a planner-selection decision question; **does not select or adopt a product planner** without explicit human review.

## 1. Environment, Pinned Versions & Integrity

- **Node:** `v24.11.1`
- **Python:** `3.13.16` (`experiments/planner-comparison/.venv/bin/python`)
- **OR-Tools:** `ortools==9.14.6206`
- **Git HEAD at generation:** `96fa4258bc703bfa789df8dc6f2d66d0d2354c7f` (tracked tree dirty: `false`)
- **CP-SAT Settings:** `num_search_workers=1`, `random_seed=0`, `max_time_in_seconds=5`, host timeout `15000ms`, `repeats=3`
- **Artifact SHA-256 Hashes:**
  - `src/domain/planner.mjs`: `48cf77510dc14c42e8e92ddc784f21c1e1c7670268de3c79f0c83f272b581715`
  - `experiments/planner-comparison/cpsat_planner.py`: `43ee153ce7266b8833be68ad3036d96da43ff457958f7ec0c5a0f32008afcaf0`
  - `experiments/planner-comparison/benchmark.mjs`: `b95b3a92d7aa737890eb1b3919aceb9240ba569477329df5f90bdb8dfd241de9`
  - `experiments/planner-comparison/cases.mjs`: `f7fd81b7303d2c0749ed83df12a96e66576f3c46f68d9c6e5e6beced2770f243`
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

6-tier weighted integer maximization with block-count dominance; solve_plan computes a conservative global upper bound `maxLowerTierSpan` on the swing of Tiers 2–6 and sets `blockWeight = max(10,000,000, maxLowerTierSpan + 1)` so CP-SAT never sacrifices a feasible study block for preferred-period, coverage, balance, or spread terms (lower tiers trade off via explicit weights).

1. **Tier 1 — Total Scheduled Study Minutes (`blockWeight = max(10,000,000, maxLowerTierSpan + 1)` per 1h block):** Dynamically computed per instance to strictly exceed the conservative global upper bound (`maxLowerTierSpan`) on the swing of Tiers 2–6 across any two feasible schedules, guaranteeing CP-SAT **never** sacrifices a feasible study block for preferred-period, coverage, balance, or spread terms.
2. **Tier 2 — Preferred Period (`W_PREF_PERIOD = 200,000` per matching block):** Used only when `preferredPeriod` is supplied.
3. **Tier 3 — Distinct Eligible Course Coverage (`W_COVERAGE = 500,000` for `course-coverage`, `50,000` default, `10,000` with `focusCourse`):** Rewards covering every eligible course at least once. Note that coverage and balance are explicit product preferences encoded into CP-SAT, not universal correctness rules.
4. **Tier 4 — Horizon & Weekly Course Balance (`W_BALANCE = 20,000`):** Minimizes `max - min` spread across eligible courses (or deviation from ~2:1 target split when `focusCourse` is set).
5. **Tier 5 — Daily Spread (`W_DAILY_SPREAD = 1,000`):** Prefers spreading blocks across days over stacking multiple sessions on a single day.
6. **Tier 6 — Deterministic Canonical Tie-Breakers (`W_TIME = 1`, `W_COURSE_RANK = 1`):** Prefers earlier day/slot in week and orders ties by `(deadline, course.name)`, independent of input course array order.

**Status & Feasibility Semantics:**
- `OPTIMAL` + `target_met`: CP-SAT met 100% of every weekly target.
- `OPTIMAL` + `proved_shortfall`: CP-SAT reached `OPTIMAL` with `blockDominanceGuaranteed = true` (`blockWeight > maxLowerTierSpan`), proving no legal schedule places more blocks under the modeled constraints (additionally cross-checked with `strictTarget: true` returning `INFEASIBLE` to confirm the full target is unattainable).
- `FEASIBLE`: legal schedule found within time cap, optimality not proved.
- `INFEASIBLE`: proved no legal schedule satisfies hard constraints (when `strictTarget: true`, proves the full weekly target is unattainable under the modeled constraints).
- `UNKNOWN` / `HOST_TIMEOUT`: time budget hit without proof; never treated as infeasibility.
- `UNAVAILABLE`: OR-Tools missing; never falls back to a heuristic.

## 3. Aggregate Summary (Core 10 Cases vs Diagnostic 2 Cases)

| Scope | Engine | Variants Passed `validateSchedule` | Deterministic | Total Scheduled / Target (min) | Avoidable Shortfall (min) | Multi-Course Default Coverage | Avg Multi-Course Imbalance | Median Latency (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Frozen (6 cases) | Heuristic (`planner.mjs`) | 12/12 | 12/12 | 8160 / 9120 | 0 | 2/5 | 396m | 1.22 |
| Frozen (6 cases) | CP-SAT (`ortools 9.14`) | 12/12 | 12/12 | 8160 / 9120 | 0 | 4/5 | 132m | 3.911 (in-proc) |
| Paired-Replay (4 cases) | Heuristic (`planner.mjs`) | 8/8 | 8/8 | 4320 / 4320 | 0 | 2/2 | 0m | 1.966 |
| Paired-Replay (4 cases) | CP-SAT (`ortools 9.14`) | 8/8 | 8/8 | 4320 / 4320 | 0 | 2/2 | 0m | 9.902 (in-proc) |
| Core Combined (10 cases) | Heuristic (`planner.mjs`) | 20/20 | 20/20 | 12480 / 13440 | 0 | 4/7 | 282.9m | 1.541 |
| Core Combined (10 cases) | CP-SAT (`ortools 9.14`) | 20/20 | 20/20 | 12480 / 13440 | 0 | 6/7 | 94.3m | 5.176 (in-proc) |
| Diagnostic Edge Cases (2 cases) | Heuristic (`planner.mjs`) | 2/2 | 2/2 | 60 / 240 | 60 | — | — | 0.042 |
| Diagnostic Edge Cases (2 cases) | CP-SAT (`ortools 9.14`) | 2/2 | 2/2 | 120 / 240 | 0 | — | — | 1.734 (in-proc) |

## 4. Per-Case Comparison

### 4.1 Frozen Readiness Cases (6 cases) & Paired-Replay Cases (4 cases)

| Case (Group) | Variant | Feasible Target (min) | Heuristic (min / courses / ms) | CP-SAT (min / courses / status / wall ms / round-trip ms) |
| --- | --- | ---: | --- | --- |
| `bruno-equal-cutoff` (frozen) | `default` | 1800m | 1800m / Banco de Dados: 1140m, Algoritmos: 660m / 7.199ms | 1800m / Banco de Dados: 900m, Algoritmos: 900m / OPTIMAL (target_met) / 92.648ms / 383.789ms |
| `bruno-equal-cutoff` (frozen) | `coverageOption` | 1800m | 1800m / Banco de Dados: 1140m, Algoritmos: 660m / 5.997ms | 1800m / Banco de Dados: 900m, Algoritmos: 900m / OPTIMAL (target_met) / 91.356ms / 384.484ms |
| `bruno-equal-cutoff` (frozen) | `reversedCourseOrder` | 1800m | 1800m / Banco de Dados: 660m, Algoritmos: 1140m / 7.569ms | 1800m / Banco de Dados: 900m, Algoritmos: 900m / OPTIMAL (target_met) / 92.602ms / 384.679ms |
| `ana-earlier-deadline` (frozen) | `default` | 240m | 240m / Machine Learning: 240m, Statistics: 0m / 1.075ms | 240m / Machine Learning: 120m, Statistics: 120m / OPTIMAL (target_met) / 5.009ms / 297.062ms |
| `ana-earlier-deadline` (frozen) | `coverageOption` | 240m | 240m / Machine Learning: 180m, Statistics: 60m / 0.895ms | 240m / Machine Learning: 120m, Statistics: 120m / OPTIMAL (target_met) / 5.135ms / 302.519ms |
| `bruno-explicit-priority` (frozen) | `default` | 1800m | 1800m / Banco de Dados: 360m, Algoritmos: 1440m / 7.039ms | 1800m / Banco de Dados: 600m, Algoritmos: 1200m / OPTIMAL (target_met) / 4007.968ms / 4301.468ms |
| `bruno-tight-capacity` (frozen) | `default` | 60m | 60m / Banco de Dados: 0m, Algoritmos: 60m / 0.884ms | 60m / Banco de Dados: 0m, Algoritmos: 60m / OPTIMAL (proved_shortfall) / 1.924ms / 293.114ms |
| `bruno-tight-capacity` (frozen) | `coverageOption` | 60m | 60m / Banco de Dados: 60m, Algoritmos: 0m / 0.735ms | 60m / Banco de Dados: 0m, Algoritmos: 60m / OPTIMAL (proved_shortfall) / 1.931ms / 295.242ms |
| `bruno-expired-course` (frozen) | `default` | 60m | 60m / Banco de Dados: 0m, Algoritmos: 60m / 1.365ms | 60m / Banco de Dados: 0m, Algoritmos: 60m / OPTIMAL (proved_shortfall) / 1.746ms / 310.092ms |
| `bruno-expired-course` (frozen) | `coverageOption` | 60m | 60m / Banco de Dados: 0m, Algoritmos: 60m / 1.475ms | 60m / Banco de Dados: 0m, Algoritmos: 60m / OPTIMAL (proved_shortfall) / 1.762ms / 300.223ms |
| `ravi-shift-exception` (frozen, held-out) | `default` | 120m | 120m / Writing: 120m, Quantitative reasoning: 0m / 0.102ms | 120m / Writing: 60m, Quantitative reasoning: 60m / OPTIMAL (proved_shortfall) / 2.797ms / 295.958ms |
| `ravi-shift-exception` (frozen, held-out) | `coverageOption` | 120m | 120m / Writing: 60m, Quantitative reasoning: 60m / 0.177ms | 120m / Writing: 60m, Quantitative reasoning: 60m / OPTIMAL (proved_shortfall) / 2.813ms / 303.643ms |
| `bruno-replay-initial` (paired-replay) | `default` | 600m | 600m / Algoritmos: 300m, Banco de Dados: 300m / 2.059ms | 600m / Algoritmos: 300m, Banco de Dados: 300m / OPTIMAL (target_met) / 14.945ms / 315.056ms |
| `bruno-replay-initial` (paired-replay) | `coverageOption` | 600m | 600m / Algoritmos: 240m, Banco de Dados: 360m / 2.434ms | 600m / Algoritmos: 300m, Banco de Dados: 300m / OPTIMAL (target_met) / 14.546ms / 321.617ms |
| `bruno-replay-post-correction` (paired-replay) | `default` | 600m | 600m / Algoritmos: 300m, Banco de Dados: 300m / 3.132ms | 600m / Algoritmos: 300m, Banco de Dados: 300m / OPTIMAL (target_met) / 15.489ms / 310.845ms |
| `bruno-replay-post-correction` (paired-replay) | `coverageOption` | 600m | 600m / Algoritmos: 300m, Banco de Dados: 300m / 2.485ms | 600m / Algoritmos: 300m, Banco de Dados: 300m / OPTIMAL (target_met) / 15.107ms / 313.194ms |
| `ana-held-out-initial` (paired-replay, held-out) | `default` | 480m | 480m / Applied Data Ethics: 480m / 1.425ms | 480m / Applied Data Ethics: 480m / OPTIMAL (target_met) / 5.167ms / 303.203ms |
| `ana-held-out-initial` (paired-replay, held-out) | `coverageOption` | 480m | 480m / Applied Data Ethics: 480m / 1.606ms | 480m / Applied Data Ethics: 480m / OPTIMAL (target_met) / 5.042ms / 300.648ms |
| `ana-held-out-post-correction` (paired-replay, held-out) | `default` | 480m | 480m / Applied Data Ethics: 480m / 1.38ms | 480m / Applied Data Ethics: 480m / OPTIMAL (target_met) / 5.258ms / 301.105ms |
| `ana-held-out-post-correction` (paired-replay, held-out) | `coverageOption` | 480m | 480m / Applied Data Ethics: 480m / 1.873ms | 480m / Applied Data Ethics: 480m / OPTIMAL (target_met) / 5.185ms / 301.287ms |

### 4.2 Diagnostic Edge Cases (Reported Separately)

| Case | Known Feasible (min) | Heuristic (min / shortfall / ms) | CP-SAT (min / status / strictTarget probe / wall ms) |
| --- | ---: | --- | --- |
| `preferred-period-boundary-packing` | 120m | 60m / avoidable 60m / 0.033ms | 120m / OPTIMAL (target_met) / — / 2.253ms |
| `zero-capacity-infeasible-target` | 0m | 0m / avoidable 0m / 0.051ms | 0m / OPTIMAL (proved_shortfall) / strictTarget=INFEASIBLE / 1.215ms |

### 4.3 Input-Order Sensitivity (`bruno-equal-cutoff`)

- **Heuristic (`src/domain/planner.mjs`):** `default` = Banco de Dados: 1140m, Algoritmos: 660m → `reversedCourseOrder` = Banco de Dados: 660m, Algoritmos: 1140m (**Order invariant:** `false` — flips by 480 minutes / 8 hours based purely on JSON array order).
- **CP-SAT (`cpsat_planner.py`):** `default` = Banco de Dados: 900m, Algoritmos: 900m → `reversedCourseOrder` = Banco de Dados: 900m, Algoritmos: 900m (**Order invariant:** `true`).

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

- **Hard-Constraint Safety (derived from outcomes):** Heuristic (`src/domain/planner.mjs`) passed `validateSchedule` on **22/22** evaluated variants (100.0%; 22 attempted). CP-SAT passed on **22/22** evaluated variants (100.0%; 22 attempted).
- **Observed Differences & Verified Root Causes:**
  1. **Equal-deadline input-order sensitivity (`bruno-equal-cutoff`):** Heuristic (`src/domain/planner.mjs:134`) sorts only by deadline and preserves JSON input order on ties: `default` = Banco de Dados: 1140m, Algoritmos: 660m vs `reversedCourseOrder` = Banco de Dados: 660m, Algoritmos: 1140m (`courseOrderInvariant=false`). CP-SAT: Banco de Dados: 900m, Algoritmos: 900m (`courseOrderInvariant=true`).
  2. **Heuristic course-rotation & urgency bugs (`ana-earlier-deadline`, `ravi-shift-exception`):** Without `allocation: "course-coverage"`, Heuristic produces Machine Learning: 240m, Statistics: 0m on `ana-earlier-deadline` and Writing: 120m, Quantitative reasoning: 0m on `ravi-shift-exception`, whereas CP-SAT produces Machine Learning: 120m, Statistics: 120m and Writing: 60m, Quantitative reasoning: 60m. **Root-cause correction:** `ana-earlier-deadline` is *not* missing a balance objective — it is a weekday-parity rotation bug at `src/domain/planner.mjs:182` (`eligible[(w + candidate.d) % eligible.length]` picks index `0` on both Wed `d=2` and Fri `d=4`, and would assign 100% to the *later*-deadline course on Tue+Thu `(1,3)`). `ravi-shift-exception` is caused by the `<= 14`-day urgency rule picking `eligible[0]` (`:180-181`) with input-order tie-breaking (`:134`). Note also that the Coverage/Imbalance columns mirror CP-SAT's own objective tiers 3–4; whether default scheduling should favor urgency or cross-course balance is a **product preference**, not a solver defect.
  3. **Avoidable shortfall under `preferredPeriod` (`preferred-period-boundary-packing`):** Heuristic placed 60m (avoidable shortfall 60m) vs CP-SAT 120m (avoidable shortfall 0m) when a preferred-period slot straddles a break boundary.
  4. **Feasibility & shortfall proofs:** With dynamic `blockWeight > maxLowerTierSpan`, CP-SAT `OPTIMAL` proves maximum block count under the modeled constraints (`proved_shortfall`), and `strictTarget: true` returning `INFEASIBLE` independently proves the full weekly target is unattainable.
- **Dependency & Latency Cost:**
  - `src/domain/planner.mjs` is ~230 lines of zero-dependency synchronous JavaScript running in **0.033–7.569 ms** (median per variant) inside Node.
  - CP-SAT requires Python + `ortools==9.14.6206` (native C++ binaries + `numpy`/`pandas`/`protobuf`, peak RSS **90.6–103.5 MiB**, **1.215–92.648 ms** in-process across 21/22 variants; `bruno-explicit-priority` reached **4007.968 ms** due to `focusCourse` 2:1 symmetry exploration near the 5s single-worker limit; **293.1–4301.5 ms** cold subprocess round-trip per call).

## 7. Headline Recommendation (For User Decision Gate)

**Do NOT bundle OR-Tools into the Node runtime.** Keep `src/domain/planner.mjs` as the zero-dependency default planner and keep CP-SAT offline in `experiments/` as a reference / property-test oracle:
1. **Fix the two 1–2 line `src/domain/planner.mjs` bugs + make `preferredPeriod` non-blocking (recommended):** Replace the weekday-parity rotation at `planner.mjs:182`, canonicalize equal-deadline tie-breaking by `(deadline, name)` at `planner.mjs:134`, and ensure `preferredPeriod` never reduces scheduled minutes (generate baseline first and accept the preferred-period variant only if total minutes do not drop). Treat default multi-course balance vs. earliest-deadline urgency as an explicit **product decision**, not an automatic CP-SAT objective port.
2. **Adopt CP-SAT as an optional Python domain service only if requirements change:** Only worthwhile if future requirements introduce coupled cross-day dependencies, variable-length/splittable tasks, or larger multi-constraint schedules where greedy + swap cannot guarantee feasibility.

## 8. Limitations

- All fixtures (`bruno`, `ana`, `ravi`) are synthetic calendars and course deadlines. Because this PR reads `ana-held-out` expected answers and evaluates `ravi`, treat both as **public regression / `dev` fixtures** rather than blind holdouts for future evaluations.
- **Shared horizon-clamp blind spot:** Both `planner.mjs:106-112` and `cpsat_planner.py:277-292` cap the entire multi-course planning horizon at the earliest upcoming deadline, so one course due in 5 days shrinks every other course's plan to one week. This benchmark does not test alternative per-course horizon policies.
- **Circular soft metrics & ungraded explanations:** The Coverage and Imbalance columns reflect CP-SAT's own objective tiers 3–4. `ana-earlier-deadline`'s original readiness purpose ("assess whether the explanation supports concentration") is not graded here.
- **Host-speed sensitivity & timezone fallback:** `bruno-explicit-priority` approaches the 5s single-worker cap (`maxTimeSeconds=5.0`), so slower CI hosts could return `FEASIBLE` instead of `OPTIMAL`; `cpsat_planner.py` also defaults missing timezone offsets to `-03:00`.
- Conflict-free schedule satisfaction (`validateSchedule` passing) does **not** establish personal student feasibility, cognitive sustainability, or learning benefit.
- Diagnostic edge cases (`preferred-period-boundary-packing`, `zero-capacity-infeasible-target`) were constructed specifically to isolate boundary/infeasibility behavior and are excluded from the core 10-case aggregate.
