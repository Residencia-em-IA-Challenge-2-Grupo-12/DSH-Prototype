# Foundation roadmap and current boundaries

The agreed product is a calendar-centered assistant for adult students. This phase uses synthetic calendars, workspaces and personas. GPT-6 Luna is the only authorized generative model, including auxiliary and evaluation roles; local embedding models are a separate dependency.

## Delivery checkpoints

1. **Experimental baseline (PR #8):** correct known scheduler defects, document what exists, run offline CI and verify the synthetic conversation, revision and separately approved calendar write. Keep the PR draft pending a readiness and merge decision.
2. **Foundation comparisons:** implement transactional shared state, isolated simulator runs and replay; compare native DSH and SDK interfaces, heuristic and constraint solvers, and four local embedding models. Present evidence and obtain selections before expanding the selected interface or planner.
3. **Collaborative workflow:** implement evidence-informed agent planning, one bounded critique, reviewable alternatives, optional feedback and checkpoints, file diffs and sandboxed tools.
4. **Evaluation:** six bilingual synthetic cases, two repeats, three retrieval approaches (36 primary episodes), supplemented by scripted personas, Luna fallback, evaluator reports and sampled human review.

## Baseline versus target

The current prototype has a companion UI, native DSH question forwarding, a simple deterministic scheduler and separate review controls. It uses one shared Calendarpit instance, the management API, JSON state, in-memory sessions and host tools. Its view groups events by day; it is not a proportional time grid. Model output can influence limited scheduler inputs but there is no enforced evidence-based critique, rich solver, durable recovery or isolated tool worker. The current preview is unauthenticated and only suitable for fictional data.

The target uses a transactional SQLite-backed domain service, isolated Calendarpit instances with the Google-compatible API, replayable checkpoints, Docker workers without credentials or Docker socket, and a proportional calendar. Recheck proposal context, evidence and calendar versions before separately approved writes. Retain actual state after partial failures. A review of an inference or question response is never calendar approval.

Embedding screening covers EmbeddingGemma 2 text, Qwen3-Embedding 0.6B, BGE-M3 and multilingual-E5-small. Freeze one model before the retrieval experiments. Synthetic evaluations measure workflow behavior and plausibility, not actual well-being improvement. Research-generated guidance needs a human admission decision.

Local-only access, provider boundaries, subprocess limits and route enforcement require implementation and verification; current host execution and read-only mode do not establish these boundaries. Automatic compaction and other auxiliary routes must be audited alongside the main model. No real calendar or workspace access is included in this phase.
