# Initial solver comparison

This is a bounded synthetic spike, not a planner selection. It compares a greedy-plus-one-eviction heuristic and OR-Tools CP-SAT using the same tasks, hard constraints, illustrative scoring and independent validator. The three cases contain three indivisible tasks each in one week. The implementation does not yet cover dependencies, splitting, time zones, conversational context, evidence, full fixture calendars or meaningful alternative generation. Its scoring weights are test inputs, not user-facing policy.

On 2026-11-06, CP-SAT from `ortools==9.14.6206` and the heuristic produced valid schedules for all three cases. CP-SAT returned OPTIMAL in each, matching the heuristic's score twice and scoring two points higher once. Individual measured solver times were roughly 1.7–3.2 ms for CP-SAT and below 0.1 ms for the heuristic; this tiny sample is not a performance benchmark or evidence of user benefit. A timeout or unknown status is not proof of infeasibility.

Reproduce in a disposable Python environment with `ortools==9.14.6206` installed:

```sh
python -m unittest discover -s tests -p 'test_solver_comparison.py'
python experiments/solver_comparison.py
```

Without OR-Tools the report marks CP-SAT unavailable instead of substituting a result. Expand the shared constraint vocabulary, realistic scenarios and evaluation before asking for the planner decision.
