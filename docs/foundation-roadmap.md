# Foundation roadmap and current boundaries

The agreed product is a calendar-centered assistant for adult students. This phase uses synthetic calendars, workspaces and personas. **`openai/gpt-6-luna`** is the default live comparison model (with `meta/muse-ember` as a verified fast runner-up, both 2/2 PASS in the [2026-11-24 baseline](evidence/live-single-agent-baseline-2026-11-24/README.md)); Google Cloud / AI Studio is also configured for optional `gemini-4-hydrogen` (`--schema-compat gemini`) confirmatory runs. All paid OpenRouter experiments enforce local SQLite budget tracking (`createModelBudget`) and disable automatic model fallback. Local embedding models are separate dependencies.

The merged demo baseline is verified at cb86720. Start with the [current closeout and experiment entry points](review/baseline-closeout-2026-11-22.md). Historical walkthrough and baseline decisions are in the [earlier readiness report](review/onboarding-readiness-2026-11-17.md).

## Product scope

Study Atlas helps students **plan, track and adapt their study** around deadlines and existing commitments, using feedback about what they actually did. The same workflow should make sense across subjects. Course documents can supply deadlines, requirements and context. Authored study activities can help test which existing tasks fit a time slot, a location or the resources the student has.

Creating or editing course content and running coursework as a product feature are out of scope for the student-facing product until an explicit product decision adds them. A SQL exercise, generated worksheet or patch may serve as a synthetic fixture in a standalone engineering investigation. Its use as a fixture does not establish a student need or justify a page, menu item or default workflow. Selected-file access and sandbox studies establish technical capabilities. Proposed student features need their own outcome and evidence.

## Delivery checkpoints

1. **Experimental baseline (done):** PR #8, follow-up #57, closeout #58, and product-scope guard #61 are merged. The clean checkout, browser evidence, provider replays, and retained recovery limits are in the [baseline closeout](review/baseline-closeout-2026-11-22.md). Pre-baseline draft PRs (`#17, #19, #20, #22, #24–#35`) are archived at git tags `archive/pr-<N>` and indexed in [retained-drafts.json](evidence/baseline-closeout-2026-11-22/retained-drafts.json). The [frozen planner cases](../experiments/planner-readiness/README.md) prepare the first comparison.
2. **Portable comparison ground & foundation seam (active — Path 2):** The harness-agnostic Foundation (`http-runner-v1`, Trusted Tool Bridge, modular `src/domain/*`, standalone zero-DSH single-agent runner, compact `list_calendar`, live replay parity, and budgeted 3-model comparison CLI) is merged (`#63`–`#68`; Epic `#10` closed, Epic `#11` narrowed to 1h Calendarpit memory). Active comparisons now run **Approach A1 & A2 (StudyBuddy Python pipelines)** vs. **Approach B (single-agent)** (`#47`), **Heuristic vs. CP-SAT** (`#45`), and **Interface walkthroughs** (`#44`), followed by **Approach C (bounded read-only delegation, `#48`)** before expanding any single stack (`#12`, `#46`).
3. **Collaborative workflow:** implement evidence-informed agent planning, one bounded critique, reviewable alternatives, optional feedback and checkpoints. Use controlled tools to read relevant sources and review proposed scheduling changes. Separate sandbox or file-diff experiments answer their own engineering questions.
4. **Evaluation:** six bilingual synthetic cases, two repeats, three retrieval approaches (36 primary episodes), supplemented by scripted personas, evaluator reports and sampled human review. Reassess the suite before freezing/running and obtain a decision before changing its size. Live model comparisons retain explicit model allowlists, disabled fallbacks, runtime-equivalence, and local budget boundaries.

## Baseline versus target

The merged experimental path contains durable claims, isolated disposable runs and brokered provider access, and a browser interface through private controller RPC. The legacy companion path remains available for some feedback and reporting features. The live subscription fallback runs DSH and the controller on the facilitator host with Calendarpit in Docker. The Docker-agent route has separate scripted evidence.

The current heuristic accepts a limited set of agent-selected parameters. Evidence-informed critique, richer alternatives and study-method personalization are later planning work. Use the readiness report for dated walkthroughs, package verification and open recovery limitations.

The target uses a transactional SQLite-backed domain service, isolated Calendarpit instances with the Google-compatible API, replayable checkpoints, Docker workers without credentials or Docker socket, and a proportional calendar. Recheck proposal context, evidence and calendar versions before separately approved writes. Retain actual state after partial failures. A review of an inference or question response is never calendar approval.

Embedding screening covers EmbeddingGemma 2 text, Qwen3-Embedding 0.6B, BGE-M3 and multilingual-E5-small. Freeze one model before the retrieval experiments. Synthetic evaluations measure workflow behavior and plausibility, not actual well-being improvement. Research-generated guidance needs a human admission decision.

Local-only access, provider boundaries, subprocess limits and route enforcement require implementation and verification; current host execution and read-only mode do not establish these boundaries. Automatic compaction and other auxiliary routes must be audited alongside the main model. No real calendar or workspace access is included in this phase.
