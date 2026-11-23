# Study Atlas — Current Status & Handoff Anchor

> **Read this first when starting a new thread.** Keep this page under ~65 lines. Update it only when a decision, baseline, or priority changes.

## Current Baseline (`main`)
- **Verified demo baseline:** Merged through `#58` (baseline closeout + frozen planner cases) and `#61` (student-facing product scope guard). See [baseline-closeout-2026-11-22.md](review/baseline-closeout-2026-11-22.md) and [foundation-roadmap.md](foundation-roadmap.md).
- **Agreed architectural direction (Path 2 — Portable Core + Pluggable Runners):** Decouple the harness-agnostic **Foundation** (frozen scenarios/specs, isolated Calendarpit + SQLite claim safety, shared deterministic/blind oracle) behind a versioned HTTP/JSON runner contract so **StudyBuddy** (hardcoded pipeline, Approach A), **DSH / non-DSH single-agent** (Approach B), and **runtime-defined delegation** (Approach C) run on equal footing with zero DSH lock-in.

## Undated Priority Queue

| Priority | Track / Issues | Concrete Goal |
| --- | --- | --- |
| **Now (High)** | **Portable Foundation Seam (`#47`, `#10`, `#11`)** | Fix `zod` phantom dep + `checkedPath` containment bug; split hardcoded demo literals and DSH glue out of `src/core.mjs`; formalize the runner contract for StudyBuddy + non-DSH single-agent replay. |
| **Now (High)** | **Interface Walkthrough (`#44`)** | Add clean `?lab=0` flag to the static Bruno/Ana prototype (`exp/interface-comparison`), run a small unaided walkthrough, and carry findings into the `#44` contract comparison. |
| **Next (Medium)** | **Solver & Sandbox Decisions (`#45`, `#12`, `#46`)** | `#45` heuristic vs CP-SAT on frozen cases; `#12` selected-syllabus sandbox (see [sandbox-options-research-2026-11-11.md](research/sandbox-options-research-2026-11-11.md)); `#46` local bilingual embeddings. |
| **Later (Low / Parked)** | **Workflow, Delegation & Eval (`#48`, `#14`, `#15`, `#42`, `#43`, `#5`)** | Reopen once the portable runner seam and `Now`/`Next` selections are settled. |

## Open / Parked Branches & Preservation
- **Active parked draft PRs:** `#59` (`exp/routine-preference`, retargeted onto `main`) and `#60` (`exp/checkin-preference`, stacked on `#59` — paused at verified 197-test / 108-event restart checkpoint).
- **Local-only preview worktree:** `DSH-Prototype-interface-comparison` (`exp/interface-comparison`, SQL probe removed at `f858ba9`; publish on a fresh clean branch if PR'd later).
- **Rescued research docs (in `docs/research/`):** [sandbox-options-research-2026-11-11.md](research/sandbox-options-research-2026-11-11.md) (`#12`) and [product-opportunity-audit-2026-11-23.md](research/product-opportunity-audit-2026-11-23.md) (`#44`).
- **Archived pre-baseline draft PRs (`#17, #19, #20, #22, #24–#35`):** Closed on GitHub; commits preserved permanently at git tags `archive/pr-<N>` and mapped in [retained-drafts.json](evidence/baseline-closeout-2026-11-22/retained-drafts.json).

## Working Rules (Thread Hygiene & Stop-Rule)
1. **One thread per bounded slice:** Avoid multi-week mega-threads; hand off via this file and PRs.
2. **Exploration stop-rule:** Autonomous spikes get **one bounded pass** (1 hypothesis → 1 inspectable artifact/check → report what uncertainty was reduced). Do not stack deeper synthetic reliability/recovery iterations without a user decision or an active `Now` blocker.
3. **Product scope guard:** Every student-facing addition must serve planning, tracking, or adapting study across subjects (see [foundation-roadmap.md#product-scope](foundation-roadmap.md#product-scope)).
