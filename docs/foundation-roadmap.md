# Foundation roadmap and current boundaries

The agreed product is a calendar-centered assistant for adult students. This phase uses synthetic calendars, workspaces and personas. GPT-6 Luna remains the default model. A later, bounded comparison also authorizes `deepseek/deepseek-v4.1-flash-1017` through OpenRouter's official DeepSeek provider, with fallback disabled and setup, agent and evaluator calls sharing the approximate $5 locally tracked target. Other generative models and paid-provider fallback are not authorized; local embedding models are separate dependencies.

## Delivery checkpoints

1. **Experimental baseline (PR #8):** correct known scheduler defects, document what exists, run offline CI and verify the synthetic conversation, revision and separately approved calendar write. Keep the PR draft pending a readiness and merge decision.
2. **Foundation comparisons:** implement transactional shared state, isolated simulator runs and replay; compare native DSH and SDK interfaces, heuristic and constraint solvers, and four local embedding models. Present evidence and obtain selections before expanding the selected interface or planner.
3. **Collaborative workflow:** implement evidence-informed agent planning, one bounded critique, reviewable alternatives, optional feedback and checkpoints, file diffs and sandboxed tools.
4. **Evaluation:** six bilingual synthetic cases, two repeats, three retrieval approaches (36 primary episodes), supplemented by scripted personas, Luna fallback, evaluator reports and sampled human review.

## Baseline versus target

The running companion has a UI, DSH question forwarding, a simple deterministic scheduler and separate review controls. It still uses the earlier shared Calendarpit management API and in-memory agent sessions; recovery work adds SQLite-backed state and durable claims on the stacked branch. The experimental managed lifecycle has isolated simulator instances, a broker and restricted agent container, but is not connected to the companion. Its scripted runs do not establish live-model behavior. See [current disposable-run progress](disposable-run-progress.md). The agent influences limited scheduler inputs; evidence-based critique and rich alternatives are not enforced. The current preview is unauthenticated and suitable only for fictional data.

The target uses a transactional SQLite-backed domain service, isolated Calendarpit instances with the Google-compatible API, replayable checkpoints, Docker workers without credentials or Docker socket, and a proportional calendar. Recheck proposal context, evidence and calendar versions before separately approved writes. Retain actual state after partial failures. A review of an inference or question response is never calendar approval.

Embedding screening covers EmbeddingGemma 2 text, Qwen3-Embedding 0.6B, BGE-M3 and multilingual-E5-small. Freeze one model before the retrieval experiments. Synthetic evaluations measure workflow behavior and plausibility, not actual well-being improvement. Research-generated guidance needs a human admission decision.

Local-only access, provider boundaries, subprocess limits and route enforcement require implementation and verification; current host execution and read-only mode do not establish these boundaries. Automatic compaction and other auxiliary routes must be audited alongside the main model. No real calendar or workspace access is included in this phase.
