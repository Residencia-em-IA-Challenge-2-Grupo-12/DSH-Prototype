# Issue #36: pre-cleanup history

Captured before the authorized 13 November 2026 organization cleanup. This is historical evidence; [the live issue](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/36) owns current scope and acceptance. Earlier candidate approaches are not newly adopted decisions.

## Current agreed recovery scope — 13 November 2026

The timing is no longer wholly undecided: bounded recovery/state changes are in #37, disposable lifecycle/provider/broker work in #38, and the thin companion/current evidence in #39. None is merged into #8. Review #41 prepares a lossless integration proposal; #9 retains the explicit baseline merge decision.

The approved demonstration path preserves uncertain-write evidence, blocks blind retries and permits a clean replacement only after verified writer/resource retirement and archival. **In-place calendar reconciliation is deferred**; earlier candidate acceptance asking for reconciliation must not silently expand the current implementation. Interrupted startup/retirement and complete facilitator recovery still have gaps; keep this issue open. The scripted managed browser loop and two real host-side Luna API loops are supporting synthetic evidence, not real-provider recovery proof.

Follow #40 for browser/package delivery and #12 for execution boundaries. Original reproductions and candidate designs below are preserved as historical context, not a claim that all remain undecided or that later code is integrated.

## Historical investigation and candidate approaches

## Problem and decision to make

The synthetic baseline can lose track of a calendar application outcome and fail to preserve a concurrent user edit. These are concrete bugs, but a reliable fix also crosses the boundary between the companion, the MCP process, persisted proposal state, the calendar provider and the user-facing review flow.

**Timing and implementation are intentionally undecided.** Decide whether to add a bounded baseline safeguard before merging #8 or resolve the problem through the shared-state redesign in #10. If deferring, explicitly document and accept the synthetic-only limitation in the #8 readiness decision; do not silently treat the behavior as safe. This issue does not authorize a merge or select an interface/planner.

## Reproduced on PR #8

Reviewed head `6bce31c1ab13740b5e5b1850254984e245c763a6`, with fictional fixtures and an in-memory fake calendar; no real account, model call or calendar was involved. The 25 existing offline tests passed, but two targeted cases failed:

1. **Write accepted, calendar becomes unreadable:** a create succeeds, then subsequent event reads fail. The failure handler awaits a further read before saving its partial-write record. The simulated event exists, but persisted proposal status remains `pending` and no partial-write history is saved. A later stale-hash check may reject a retry once the calendar is readable; this is a state/communication failure, not proof of a duplicate write. [Application code](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/6bce31c1ab13740b5e5b1850254984e245c763a6/src/core.mjs#L190-L222).
2. **User edit during application:** an existing demo-owned event is edited after the initial check but before application continues. The resulting error path saves the changed snapshot without adding that event to protected IDs. A subsequent draft proposes it for removal. A separate explicit approval is still needed; this is not an observed automatic deletion. [Error handling and checkpoint comparison](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/6bce31c1ab13740b5e5b1850254984e245c763a6/src/core.mjs#L203-L237).

The existing partial-write test injects a create failure while later reads remain available: [test](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/6bce31c1ab13740b5e5b1850254984e245c763a6/tests/approval-boundaries.test.mjs#L32-L52). A review-only candidate was explored in an isolated copy and **was not applied to the PR**; it showed that a current-proposal flag alone is insufficient because another state writer can replace it, and the status UI depends on calendar reads succeeding.

## Architectural questions

- The baseline uses per-process locks and independent JSON state writers in the companion and MCP processes. A read–modify–write from another process can overwrite recovery state; the complete set of mutation routes includes planning, checkpoints, feedback, annotations, narrative and reset. Inspect actual calls and select a shared coordination boundary rather than relying on a JavaScript in-memory lock.
- A provider request and a local database transaction cannot be made one atomic operation. A request may have succeeded even when its response is lost. Persist the application's intent before provider mutations, distinguish confirmed actions from unknown outcomes, and do not infer absence from an unavailable or prematurely observed calendar. Define idempotency and provider-specific behavior explicitly.
- A failed or stale calendar read must not be represented as an empty or current calendar. Preserve enough evidence and version information to reconcile and protect user changes. Human-visible recovery must remain usable when provider reads fail.
- [PR #27](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/27) experiments with SQLite-backed application claims and `pending`/`unknown`/`review` states. It is useful evidence, not a drop-in solution: it is unintegrated, unauthenticated, create-only, its reconciliation UI/API is absent, and its local lock/provider checks do not establish full cross-container or external-provider guarantees. [#17](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/17) and [#24](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/24) contain related store/service experiments whose copies must be reconciled.

## Candidate approaches — to compare, not a preselected design

1. **Bounded baseline safeguard:** introduce an appropriately durable, cross-process-aware application/recovery boundary for the existing synthetic baseline, provide explicit unknown-outcome and review behavior, and constrain other mutations while reconciliation is required. Assess crash recovery and UX carefully; a process-local lock or a `partial` flag alone is not sufficient. Lower immediate scope, but possible rework when #10 lands.
2. **Integrate shared transactional state:** adapt and reconcile the relevant #10/#17/#24/#27 experiments into the baseline, then extend beyond one create to the actual multi-action workflow and add reconciliation. Stronger alignment with the intended architecture, but broader scope, integration risk and a longer path to a baseline merge. Do not claim that SQLite alone makes remote writes atomic.
3. **Explicitly defer:** retain #8 as synthetic-only with the behavior and constraints prominently documented, make a conscious baseline merge decision, and address the full boundary under #10. This accepts a known defect in the shared baseline and is **not** the current recommendation unless the team accepts that tradeoff.

## Acceptance criteria for a selected fix

- [ ] Record the reviewed design and timing decision, its scope, and which processes/routes must coordinate; preserve #8's explicit merge-decision checkpoint.
- [ ] Before a remote mutation can start, durably record its intent/claim. After interruption, lost response, failed post-write read or local persistence error, preserve an explicit pending/unknown/review state; report only confirmed actions and clearly identify unavailable or potentially incomplete observations.
- [ ] Block unreviewed retries, later sections and new drafts/other state mutations that could overwrite the unresolved outcome; support a deliberate, documented reconciliation and renewed review without silently discarding user data. Define how crashes and explicit resets are handled.
- [ ] Preserve and surface user-edited events observed during failed/stale application, checkpoints and replanning. A subsequent proposal must not silently mark them for removal. Existing event descriptions and ownership remain intact.
- [ ] The user can understand the status and next step in English and Brazilian Portuguese even if the calendar cannot currently be fetched. No stale snapshot should be labeled current or imply all attempted writes succeeded.
- [ ] Add deterministic regressions for both reproduced cases; include write-accepted/response-lost, read failure, process interruption/restart, failed local persistence, stale/concurrent calendar edits, later-draft/other-process state races, separate approval and partial multi-action outcomes. Verify actual resulting state when it can be observed; otherwise explicitly report unknown. Include a live synthetic simulator test where feasible.
- [ ] Document remaining limitations, especially external provider races, daemon/process failure, authentication and the fact that synthetic emulator results do not establish real-provider guarantees.

Related: baseline readiness #9, shared transactional state #10, planning/checkpoint reconciliation #4, synthetic bridge #27, baseline PR #8. No timing, merge or architecture selection has been made by creating this issue.

## Inspection and proposed PR reconciliation — 2026-11-09

**Recommendation, not a completed decision:** bring forward a bounded portion of #10 for #8: one trusted local state/application module backed by transactional SQLite, used by both the companion and MCP entry points, with a durable per-application/per-action journal and explicit recovery. Reconcile and reuse appropriate mechanisms from #17/#24/#27; do not integrate the entirety of #27 or maintain two competing state authorities. Deliver the work as a focused child PR against #8, with reviewable commits; review its actual changes before merging into #8. The #8 merge remains an explicit user decision. If this cut grows into most of the full shared-service architecture, stop and revisit timing with the team. Do not select the interface, planner or embedding model through this work.

### Additional verified behavior on the pinned #8 head

- **Lost feedback:** pause a checkpoint after it loads state but before its calendar read returns; save feedback from a second caller; resume the checkpoint. Its whole-file save overwrites the feedback. Reproduced both with interleaved calls in one process and with checkpoint and feedback in **separate Node processes**, using only an isolated synthetic runtime and fake provider. The existing atomic file rename prevents a torn file, not a lost read–modify–write update.
- **Annotation outcome:** make a simulated annotation patch succeed and the subsequent calendar read fail. The provider's event contains the patch while the persisted annotation decision remains apparently untouched. This is an additional confirmed write-outcome gap; it is not proof of an automatic duplicate.
- Additional source inspection: reset, draft, checkpoint, feedback, annotation, narrative and approval paths can mutate shared state; reset also replaces the shared simulator. A student-only or process-local lock is therefore not a complete coordination scheme. `/api/status` combines local and calendar reads, so calendar unavailability currently prevents the UI from fetching the local recovery status.

### Proposed implementation order

1. Preserve four failure scenarios as deterministic tests in an isolated fixture, including the actual cross-process race. Reconcile #17/#24 with #27's materially different schema and application-claim code; select one canonical state authority and an explicit, tested synthetic-state import or archived reset. No silent loss of `.runtime` history.
2. Route every baseline state mutation through that authority. Persist reviewed decision and application intent before external writes; track ordered create/remove/annotation actions and confirmed versus unknown outcomes. Avoid holding a SQLite transaction across network calls; a local database cannot make a provider write atomic.
3. Add human-reviewed reconciliation, protected-user-edit handling, explicit simulator-unavailable status in both languages, safe restart and explicit synthetic reset semantics. Block operations that could erase an unresolved result; allow unrelated transactional updates only when they cannot invalidate it. Do not treat a quick absent read after a timeout as proof that an outstanding request cannot complete later.
4. Test error-after-write, lost response, delayed provider completion, unavailable reads, local persistence failure, restart, shared simulator reset, competing processes, later draft, concurrent edits, per-section approval and multi-action partial outcomes. Add a live isolated Calendarpit check and a browser/Luna walkthrough. Document limits; do not infer real-provider guarantees or security from these tests.
5. Review the child PR and the resulting #8 diff, then obtain the separate #8 merge decision. Develop the complete Docker baseline separately as previously agreed. Subsequent interface/planner/embedding selections remain explicit checkpoints.

### PR consolidation implications

- #16 and #23 contain byte-identical replay code, but #23 lacks #16's dedicated replay tests; preserve those before considering closure.
- #17/#24 and #27 contain differing state implementations; #27 adds claims and schema changes. Reconcile the code, migrations and tests before retargeting the remaining bridge work.
- #19 and #35 contain identical original solver code/tests, but different CI discovery; preserve the wider coverage. Keep #25/#35 as comparison evidence, not a planner decision.
- #22, #31 and #34 have overlapping aims but distinct implementations/tests; review what to retain rather than assuming they are duplicates. Keep #33 and #34 available for the fair interface comparison.
- Preserve #18 → #21 → #23 as simulator lifecycle/provider/replay work, and #20 → #26 as embedding-screening work. #28 is an isolated worker experiment; #29 packages only the domain service; #32 contains inactive guidance dossiers.

Retarget or rebase only after the canonical baseline is stable, inspect each resulting diff and rerun checks; preserve branch references and evidence until supersession is demonstrated. No PR has been merged, closed, retargeted or selected by this plan.

