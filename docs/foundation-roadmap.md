# Foundation roadmap and current boundaries

The agreed product is a calendar-centered assistant for adult students. This phase uses synthetic calendars, workspaces and personas. GPT-6 Luna remains the default model. A later, bounded comparison also authorizes `deepseek/deepseek-v4.1-flash-1017` through OpenRouter's official DeepSeek provider, with fallback disabled and setup, agent and evaluator calls sharing the approximate $5 locally tracked target. Other generative models and paid-provider fallback are not authorized; local embedding models are separate dependencies.

The merged demo baseline is verified at cb86720. Start with the [current closeout and experiment entry points](review/baseline-closeout-2026-11-22.md). Historical walkthrough and baseline decisions are in the [earlier readiness report](review/onboarding-readiness-2026-11-17.md).

## Product scope

Study Atlas helps students **plan, track and adapt their study** around deadlines and existing commitments, using feedback about what they actually did. The same workflow should make sense across subjects. Course documents can supply deadlines, requirements and context. Authored study activities can help test which existing tasks fit a time slot, a location or the resources the student has.

Creating or editing course content and running coursework as a product feature are out of scope for the student-facing product until an explicit product decision adds them. A SQL exercise, generated worksheet or patch may serve as a synthetic fixture in a standalone engineering investigation. Its use as a fixture does not establish a student need or justify a page, menu item or default workflow. Selected-file access and sandbox studies establish technical capabilities. Proposed student features need their own outcome and evidence.

## Delivery checkpoints

1. **Experimental baseline (done):** PR #8, follow-up #57, closeout #58, and product-scope guard #61 are merged. The clean checkout, browser evidence, provider replays, and retained recovery limits are in the [baseline closeout](review/baseline-closeout-2026-11-22.md). Pre-baseline draft PRs (`#17, #19, #20, #22, #24–#35`) are archived at git tags `archive/pr-<N>` and indexed in [retained-drafts.json](evidence/baseline-closeout-2026-11-22/retained-drafts.json). The [frozen planner cases](../experiments/planner-readiness/README.md) prepare the first comparison.
2. **Portable comparison ground & foundation seam (active — Path 2):** Decouple the harness-agnostic Foundation (frozen bilingual scenarios/specs, isolated Calendarpit + SQLite claim safety, deterministic/blind oracle) behind a versioned HTTP/JSON runner contract so **StudyBuddy** (hardcoded multi-agent pipeline, Approach A), **DSH / plain non-DSH single-agent** (Approach B), and **runtime-defined delegation** (Approach C, `#48`) run on equal footing with zero DSH lock-in (`#47`, `#10`, `#11`). Present evidence and obtain selections across interface (`#44`), planner (`#45`), sandbox (`#12`), and local embeddings (`#46`) before expanding any single stack.
3. **Collaborative workflow:** implement evidence-informed agent planning, one bounded critique, reviewable alternatives, optional feedback and checkpoints. Use controlled tools to read relevant sources and review proposed scheduling changes. Separate sandbox or file-diff experiments answer their own engineering questions.
4. **Evaluation:** six bilingual synthetic cases, two repeats, three retrieval approaches (36 primary episodes), supplemented by scripted personas, authorized Luna fallback, evaluator reports and sampled human review. Reassess the suite before freezing/running and obtain a decision before changing its size. The separate preliminary/matched Luna–DeepSeek comparison and masked DeepSeek evaluator retain their authorized route, runtime-equivalence and shared cost boundaries.

## Baseline versus target

The merged experimental path contains durable claims, isolated disposable runs and brokered provider access, and a browser interface through private controller RPC. The legacy companion path remains available for some feedback and reporting features. The live subscription fallback runs DSH and the controller on the facilitator host with Calendarpit in Docker. The Docker-agent route has separate scripted evidence.

The current heuristic accepts a limited set of agent-selected parameters. Evidence-informed critique, richer alternatives and study-method personalization are later planning work. Use the readiness report for dated walkthroughs, package verification and open recovery limitations.

The target uses a transactional SQLite-backed domain service, isolated Calendarpit instances with the Google-compatible API, replayable checkpoints, Docker workers without credentials or Docker socket, and a proportional calendar. Recheck proposal context, evidence and calendar versions before separately approved writes. Retain actual state after partial failures. A review of an inference or question response is never calendar approval.

Embedding screening covers EmbeddingGemma 2 text, Qwen3-Embedding 0.6B, BGE-M3 and multilingual-E5-small. Freeze one model before the retrieval experiments. Synthetic evaluations measure workflow behavior and plausibility, not actual well-being improvement. Research-generated guidance needs a human admission decision.

Local-only access, provider boundaries, subprocess limits and route enforcement require implementation and verification; current host execution and read-only mode do not establish these boundaries. Automatic compaction and other auxiliary routes must be audited alongside the main model. No real calendar or workspace access is included in this phase.
