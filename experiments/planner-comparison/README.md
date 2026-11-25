# Issue #45: Corrected Heuristic vs CP-SAT Planner Comparison

Self-contained comparison between the production heuristic (`src/domain/planner.mjs`) and an OR-Tools CP-SAT prototype (`experiments/planner-comparison/cpsat_planner.py`) behind the exact same planning context, calendar boundary, and schedule validation contract.

This experiment keeps **zero impact on Node runtime dependencies** (`package.json` and `package-lock.json` are untouched).

## Setup (Isolated Python Environment)

```sh
cd experiments/planner-comparison
uv sync
```

Pinned dependency: `ortools==9.14.6206` (see `pyproject.toml` and `uv.lock`).

## Run Tests & Benchmark

1. **Python CP-SAT unit tests** (hard constraints, determinism, order invariance, infeasibility proof):
   ```sh
   experiments/planner-comparison/.venv/bin/python -m unittest discover -s experiments/planner-comparison/tests -p 'test_*.py' -v
   ```
2. **Offline Node benchmark tests** (passes both with `.venv` present and in CI without OR-Tools, where CP-SAT reports `UNAVAILABLE`):
   ```sh
   TMPDIR=/tmp ./node_modules/.bin/node --test --import ./tests/isolate-runtime.mjs tests/planner-comparison.test.mjs
   ```
3. **Regenerate the evidence bundle**:
   ```sh
   TMPDIR=/tmp ./node_modules/.bin/node experiments/planner-comparison/benchmark.mjs \
     --write-evidence docs/evidence/planner-heuristic-vs-cpsat-2026-11-25
   ```
