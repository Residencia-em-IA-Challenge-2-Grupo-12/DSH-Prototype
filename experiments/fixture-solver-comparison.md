# Fixture-based solver comparison — exploratory

This single-week experiment builds its availability windows, busy intervals, study goals, fixed clock and deadlines from the versioned synthetic persona fixtures introduced in `feat/realistic-bilingual-personas` / draft PR #25. It compares the existing CP-SAT model and an improved greedy heuristic with one-task eviction using identical inputs and the same illustrative objective. An independent post-solve validator checks all returned assignments against windows, existing commitments, deadlines, daily caps and gaps. The heuristic's incremental feasibility check does not call that post-solve validator.

The scenario inputs are more realistic than the earlier three-task hand-built examples, but the study tasks are **invented decompositions**, not extracted assignments. Uniform cases split each fixture's target into one-hour tasks; mixed cases split the same target into a repeating 90/30/60-minute pattern. All generated tasks have equal illustrative priority. Stress cases double the fixture goal. The deliberately adversarial packing case is hand-built and has mixed priorities; it is not a student's schedule.

Every case uses 30-minute time slots, a **test assumption** of a 120-minute daily study cap and a 30-minute gap between proposed study blocks. No gap is enforced between study and existing classes, work, travel or meals; the model therefore does not establish transition feasibility. Windows round inward and busy events outward, preserving commitments; unsupported all-day or missing time data fails closed. These choices are not individual recommendations, approved evidence, or product policy. The adapter explicitly supports the fixed São Paulo timezone without offset transitions and only one week; it does not support multi-week planning, flexible splitting, task dependencies, alternatives, evidence, uncertainty or user preferences. The second-week exam case includes the fixture's extra Tuesday appointment. Recorded solver runs use English fixtures; Portuguese is checked for structural timing parity rather than run as a separate scenario.

## Results from this local run

A single run on 2026-11-07 used Python 3.13.16 and OR-Tools 9.14.6206, one CP-SAT worker and a five-second **solver-search** limit per case. All returned schedules passed the independent validator. The JSON result contains the exact source and fixture hashes, model statuses, assignments, objective scores, durations, omissions, timing and assumptions. Timing is uncontrolled local measurement, not a performance benchmark; model construction and total process wall time are not bounded by the CP-SAT search parameter.

| Fictional case | Goal | Heuristic scheduled | CP-SAT scheduled | CP-SAT status |
| --- | ---: | ---: | ---: | --- |
| Working college, week 1, uniform | 6 h | 4 h | 4 h | OPTIMAL |
| Nonworking college, week 1, uniform | 7 h | 5 h | 5 h | OPTIMAL |
| Employed exam prep, week 1, uniform | 6 h | 5 h | 5 h | OPTIMAL |
| Working college, week 1, mixed durations | 6 h | 5 h | 4.5 h | OPTIMAL |
| Nonworking college, week 1, mixed durations | 7 h | 6.5 h | 7 h | OPTIMAL |
| Employed exam prep, week 1, mixed durations | 6 h | 6 h | 6 h | OPTIMAL |
| Employed exam prep, week 2, uniform | 6 h | 4 h | 4 h | OPTIMAL |
| Hand-built adversarial case | — | 2 h | 3 h | OPTIMAL |

The doubled-goal stress cases each scheduled the same minutes as their corresponding uniform baseline and omitted additional optional tasks. These omissions are not a diagnosis of a student's available time. Different block lengths, break assumptions, caps, priorities, user preferences or week boundaries can change the result substantially.

In the nonworking mixed case, the heuristic omitted a task while CP-SAT scheduled all seven under this model. In the working mixed case, CP-SAT achieved a **higher illustrative objective score** while scheduling **fewer minutes** than the heuristic. The objective awards priority per task and small timing bonuses, not minutes; a higher score is therefore not a judgment of a better or more beneficial plan. This is a concrete reason to specify objectives and evaluation criteria before choosing a planner.

`OPTIMAL` means the solver proved its best objective for this discretized model with optional tasks; it is **not** a general proof that a person's study goal is infeasible. `FEASIBLE` does not establish optimality; `UNKNOWN` or timeout does not establish infeasibility. The experiment cannot establish learning, wellness or usability outcomes, or choose an interface or planner for the product.

## Reproduce

Use the files in this bundle on a branch containing the persona fixtures and the earlier `experiments/solver_comparison.py`, plus a separate Python environment with `ortools==9.14.6206`:

```sh
python -m unittest discover -s tests -p 'test*solver_comparison.py' -v
python experiments/fixture_solver_comparison.py --timeout 5 > /tmp/fixture-solver-results.json
```

Without OR-Tools, deterministic tests still run and CP-SAT reports `UNAVAILABLE`; do not interpret this as a solver result. The tests cover EN/PT fixture timing parity, conservative rounding, the week-2 exception, independent validation, score-versus-time tradeoffs, optional-task status and a constructed case where the heuristic leaves more work unscheduled. Run larger realistic scenarios, robust latency/resource tests, real task decomposition, constraint variety, and human review before making the planned foundation selection.
