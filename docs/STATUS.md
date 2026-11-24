# Study Atlas — Current Status & Handoff Anchor

> **Read this first when starting a new thread.** Keep this page under ~65 lines. Update it only when a decision, baseline, or priority changes.

## Current Baseline (`main`)
- **Verified portable core (`main` through `#67`):** `http-runner-v1` + bearer-protected Trusted Tool Bridge (`#63`), modular `src/domain/*` + multi-case operator (`#64`), standalone zero-DSH single-agent HTTP runner (`#65`), compact agent-facing `list_calendar` (~61–62% payload reduction) + `--schema-compat gemini` / custom OpenRouter allowlist (`#66`), and live-replay parity fixes (`#67`).
- **Live 3-model single-agent baseline (`2026-11-24`):** See [live-single-agent-baseline-2026-11-24/README.md](evidence/live-single-agent-baseline-2026-11-24/README.md) (`scripts/compare-live-models.mjs`, `$0.0749` total across 6 Docker Calendarpit runs). `openai/gpt-6-luna` (**2/2 PASS**, `$0.0137` total) and `meta/muse-ember` (**2/2 PASS**, `$0.0172` total, fastest at `46s` avg) both passed `bruno` and `ana-held-out` cleanly; `deepseek/deepseek-v4.1-flash-1017` (`fireworks`) failed both (`0/2`, `$0.0440`). Default live comparison model is now **`openai/gpt-6-luna`**.
- **Agreed architectural direction (Path 2 — Portable Core + Pluggable Runners):** Decouple the harness-agnostic **Foundation** behind `http-runner-v1` so **Approach A (StudyBuddy hardcoded pipeline)**, **Approach B (single-agent non-DSH + pinned DSH)**, and **Approach C (bounded read-only delegation, `#48`)** run on equal footing.

## Undated Priority Queue

| Priority | Track / Issues | Concrete Goal |
| --- | --- | --- |
| **Now (High)** | **Approach A vs B (`#47`)** | Build a standalone Python FastAPI `/replay` prototype inside `DSH-Prototype` faithful to StudyBuddy's staged pipeline (`Escopo → Triagem → Pesquisa → Planejador → Verificador`), run head-to-head against Approach B on `openai/gpt-6-luna` (same bundles/oracle), and carry proven choices into a later `studybuddy` rewrite. |
| **Now (High)** | **Interface Walkthrough (`#44`)** | Prototype has `?lab=0` + `WALKTHROUGH-CHECKLIST.md` on local `exp/interface-comparison`; run 3–5 quick classmate walkthroughs and publish findings + winning direction. |
| **Next (Medium)** | **Delegation & Solver (`#48`, `#45`)** | After A-vs-B streamlines our understanding, evaluate **Approach C (`#48`)** with well-designed tests (without overfitting to A/B quirks), and compare heuristic vs CP-SAT (`#45`) behind `src/domain/planner.mjs`. |
| **Later (Parked)** | **Sandbox, Embeddings & Product Polish (`#11`, `#12`, `#46`, `#14`, `#15`, `#42`, `#43`, `#5`)** | Epic `#10` closed (`2026-11-24`); Epic `#11` narrowed solely to the 1h Calendarpit 0.9.7 OOMKill finding. Keep `#12`/`#46`/`#5`/`#42`/`#43` explicitly parked until core architecture & UI settle. |

## Open / Parked Branches & Preservation
- **Active parked draft PRs:** `#59` (`exp/routine-preference`) and `#60` (`exp/checkin-preference`, local worktree `DSH-Prototype-checkin-preference`) — explicitly parked until after `#44` walkthroughs and `#47` A-vs-B results.
- **Local-only preview worktree:** `DSH-Prototype-interface-comparison` (`exp/interface-comparison`, `?lab=0` + checklist at `7717a69`) — kept local for walkthroughs.
- **Rescued research docs (in `docs/research/`):** [sandbox-options-research-2026-11-11.md](research/sandbox-options-research-2026-11-11.md) (`#12`) and [product-opportunity-audit-2026-11-23.md](research/product-opportunity-audit-2026-11-23.md) (`#44`).
- **Archived pre-baseline draft PRs (`#17, #19, #20, #22, #24–#35`):** Closed on GitHub; preserved at git tags `archive/pr-<N>`.

## Working Rules (Thread Hygiene & Stop-Rule)
1. **One thread per bounded slice:** Avoid multi-week mega-threads; hand off via this file and PRs.
2. **Exploration stop-rule:** Autonomous spikes get **one bounded pass** (1 hypothesis → 1 inspectable artifact/check → report what uncertainty was reduced).
3. **Product scope guard:** Every student-facing addition must serve planning, tracking, or adapting study across subjects (see [foundation-roadmap.md#product-scope](foundation-roadmap.md#product-scope)).
