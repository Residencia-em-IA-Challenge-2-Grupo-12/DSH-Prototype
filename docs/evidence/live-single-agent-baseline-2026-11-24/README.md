# Live Single-Agent Model Baseline (2026-11-24)

- **Scenario:** `success` (real Docker Calendarpit + local SQLite budgeted OpenRouter gateway + independent Python probe)
- **Total observed OpenRouter spend:** `$0.0749` USD across 6 run(s)

| Model | Case | Overall | Probe | Duration | Steps / Tools | Tool Errs | Questions (Turns) | Input / Output Tokens | Observed USD | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `openai/gpt-6-luna` | `bruno` | **PASS** | PASS | 51.2s | 16 / 15 | 0 | 4 (1) | 229,160 / 3,886 | $0.0068 | All replay checks passed; retirement verified |
| `openai/gpt-6-luna` | `ana-held-out` | **PASS** | PASS | 56.5s | 16 / 16 | 1 | 3 (1) | 198,663 / 5,299 | $0.0069 | All replay checks passed; retirement verified |
| `deepseek/deepseek-v4.1-flash-1017` | `bruno` | **FAIL** | PASS | 86.2s | 15 / 13 | 0 | 5 (2) | 301,624 / 13,602 | $0.0140 | feasibility: Study time differs from the reviewed target in week 2; execution: The replay run did not complete. Inspect the private runtime and local diagnostic. |
| `deepseek/deepseek-v4.1-flash-1017` | `ana-held-out` | **FAIL** | PASS | 243.3s | 11 / 10 | 1 | 4 (1) | 220,876 / 38,140 | $0.0300 | execution: The replay run did not complete. Inspect the private runtime and local diagnostic.; Runner did not draft a reviewable study proposal |
| `meta/muse-ember` | `bruno` | **PASS** | PASS | 44.6s | 14 / 14 | 0 | 4 (1) | 266,943 / 10,026 | $0.0090 | All replay checks passed; retirement verified |
| `meta/muse-ember` | `ana-held-out` | **PASS** | PASS | 47.3s | 15 / 15 | 1 | 4 (1) | 244,170 / 9,635 | $0.0082 | All replay checks passed; retirement verified |
