# Synthetic calendar claim: findings and decision points

Status: bounded experiment for #36; PR #37 remains draft. This does not establish safe behavior for personal data or real calendar providers.

## What the connection showed

The companion and MCP code currently share the same application module and can use one local SQLite database. Plan approvals, annotation approvals and synthetic fixture reset now acquire a simulator-wide claim. The selected decision and actions are stored before provider mutation; each action advances through sent, acknowledged and observed states. A completed operation archives the claim in the same transaction that records the final state. Drafts, checkpoints, other calendar decisions and reset are blocked while a claim is outstanding. Feedback remains available during an approval but is blocked during reset.

The offline tests cover two processes using the same database, a killed writer, a competing reset and annotation, a failed database claim, a misleading reset response, and a fake provider that delivers a create only after its response was lost and an initial observation found no event. The claim stays open in the latter case. Normal reset, approval and annotation also passed against a separate memory-only instance of the pinned Calendarpit image. These are synthetic tests; they do not establish provider idempotency, timing guarantees or exactly-once behavior.

## What is still missing

1. **Recovery and evidence.** The claim and action journal persist; the UI shows their status and a compact action list in both languages even if the calendar is unavailable. It does not yet show a complete calendar-difference review or provide a safe run-retirement workflow. No manual or automatic claim-clearing feature has been added, so a claim can block the prototype indefinitely.
2. **A safe boundary around a reset.** Calendarpit reset affects the shared simulator. Acknowledging uncertainty or observing an absent event does not prove that an already-sent request cannot arrive later. Starting another instance safely may require retiring the old origin, stopping or isolating all writers and preserving the old evidence before using a new run identity. The prototype does not enforce those conditions today.
3. **One enforceable authority.** Coordination applies only to callers using this application module and the same local SQLite file. Calendarpit administration, native DSH host tools, another runtime directory, or a separate container volume can bypass it. Cross-container deployment and the planned sandbox need an actual authority/identity design; SQLite does not provide authentication or make the provider's read–write sequence atomic.
4. **Migration and completeness.** A legacy partial operation may predate claims. It needs explicit review or archival rather than being silently treated as safe. Context/file changes, provider-specific conditional updates, actions during reset failure, persistence errors at every journal step, the full offline UI and recovery after restart remain incompletely tested.
5. **Product behavior.** Recovery needs clear bilingual states and a decision on what evidence the person can inspect, what action is safe, and when a separate approval is required. Later real-provider testing must address authorization, event identity, recurrence, ETags and provider-specific late outcomes.

## Recommended scope and next decision

Keep the child PR and #8 draft. The subsequent design checkpoint chose a disposable simulator and per-run agent, retained evidence, and a fresh synthetic run after verified retirement of an interrupted write. In-place reconciliation is deferred. Do not offer a generic “clear claim” action as a substitute for those guarantees.

After that decision, a bounded synthetic recovery implementation can add an inspectable offline status, reviewed reconciliation for cases the evidence actually supports, and a deliberate new-run path that archives old evidence and retires the old execution boundary. Keep richer domain-service, worker sandbox, real-provider compatibility and planner/interface selection on their existing tracks. If retiring writers and preserving run identity requires building most of that future isolation stack, stop and present the measured expansion before deciding whether to broaden #37 or keep #8 as an explicitly limited baseline.
