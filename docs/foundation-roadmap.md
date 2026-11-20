# Foundation roadmap and current boundaries

The agreed product is a calendar-centered assistant for adult students. This phase uses synthetic calendars, workspaces and personas. GPT-6 Luna remains the default model. A later, bounded comparison also authorizes `deepseek/deepseek-v4.1-flash-1017` through OpenRouter's official DeepSeek provider, with fallback disabled and setup, agent and evaluator calls sharing the approximate $5 locally tracked target. Other generative models and paid-provider fallback are not authorized; local embedding models are separate dependencies.

For delivery evidence and remaining limits, start with the [baseline readiness report](review/onboarding-readiness-2026-11-17.md). [Issue #9](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/9) owns the current baseline decision.

## Delivery checkpoints

The [current Project work sequence](project-work-sequence.md) separates demonstration delivery and lossless integration review from later scheduling/activity experiments. The new study-method exploration follows a stable experimental baseline; it does not require every open experimental PR to merge. PR #8 still requires the user's explicit decision.

1. **Experimental baseline (PR #8):** correct known scheduler defects, document what exists, run offline CI and verify the synthetic conversation, revision and separately approved calendar write. Keep the PR draft pending a readiness and merge decision.
2. **Foundation comparisons:** implement transactional shared state, isolated simulator runs and replay; compare native DSH and SDK interfaces, heuristic and constraint solvers, and four local embedding models. Present evidence and obtain selections before expanding the selected interface or planner.
3. **Collaborative workflow:** implement evidence-informed agent planning, one bounded critique, reviewable alternatives, optional feedback and checkpoints, file diffs and sandboxed tools.
4. **Evaluation:** six bilingual synthetic cases, two repeats, three retrieval approaches (36 primary episodes), supplemented by scripted personas, authorized Luna fallback, evaluator reports and sampled human review. Reassess the suite before freezing/running and obtain a decision before changing its size. The separate preliminary/matched Luna–DeepSeek comparison and masked DeepSeek evaluator retain their authorized route, runtime-equivalence and shared cost boundaries.

## Baseline versus target

The original #8 companion uses the shared simulator management API and JSON state. The proposed stack adds durable write claims (#37), disposable runs and brokered provider access (#38), and a browser interface through private controller RPC (#39). The live subscription fallback runs DSH and the controller on the facilitator host with Calendarpit in Docker. The managed Docker-agent route has separate scripted evidence.

The current heuristic accepts a limited set of agent-selected parameters. Evidence-informed critique, richer alternatives and study-method personalization are later planning work. Use the readiness report for dated walkthroughs, package verification and open recovery limitations.

The target uses a transactional SQLite-backed domain service, isolated Calendarpit instances with the Google-compatible API, replayable checkpoints, Docker workers without credentials or Docker socket, and a proportional calendar. Recheck proposal context, evidence and calendar versions before separately approved writes. Retain actual state after partial failures. A review of an inference or question response is never calendar approval.

Embedding screening covers EmbeddingGemma 2 text, Qwen3-Embedding 0.6B, BGE-M3 and multilingual-E5-small. Freeze one model before the retrieval experiments. Synthetic evaluations measure workflow behavior and plausibility, not actual well-being improvement. Research-generated guidance needs a human admission decision.

Local-only access, provider boundaries, subprocess limits and route enforcement require implementation and verification; current host execution and read-only mode do not establish these boundaries. Automatic compaction and other auxiliary routes must be audited alongside the main model. No real calendar or workspace access is included in this phase.
