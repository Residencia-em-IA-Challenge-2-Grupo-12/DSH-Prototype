# Contributing

Use focused issues and feature branches. Keep fixtures synthetic; never commit credentials or real calendar data. For dependent branches, follow [Stacked PRs](STACKED_PRS.md). The [consolidation proposal](../docs/pr-consolidation-proposal.md) is a preservation/review map, not merge authorization.

## Start and hand off work

### Start

1. Identify the canonical issue and read its outcome, acceptance, parent/blockers, linked PR and current Project state. Record the actual branch, base and head. If no accountable person is assigned, state the ownership gap; do not invent an owner.
2. Preserve uncommitted and untracked work. Refresh live issue, Project and PR state before editing those surfaces. Keep the change within the issue's scope and its explicit gates.
3. Treat sources according to what they own: the issue and Project own current outcome, acceptance, owner, status, priority, dependencies and next action; the PR and Git refs own proposed code scope, ancestry, tested revision and disposition; decision docs own accepted rationale and boundaries; versioned evidence owns observations and limitations. READMEs route readers to those sources instead of duplicating live status.

### Check user-facing scope

Before adding a user-facing screen, tool or example, name the planning, tracking or adaptation task it serves and the evidence that would show it helped. Replace the example subject with a different one as a quick check. A subject-specific example is fine when the workflow and need still make sense. Keep technical probes outside normal student navigation, label scripted output, and report what the probe actually verifies. If it creates a new product outcome, record an explicit scope decision before treating it as a feature. [Product scope](../docs/foundation-roadmap.md#product-scope)

### Handoff

1. Account for every current acceptance item as **met**, **unmet** or **not observed**. Link evidence and identify the source commit/configuration, command or observation, date when relevant, and limitations. Preserve failed attempts and residual work. Do not present scripted evidence as live-model behavior or a proposal as an adopted decision.
2. Update the canonical issue with the current result, concrete next action, blockers and ownership or explicit ownership gap. Synchronize actual labels, parent/dependency links and Project status when applicable, then read back the saved result. If a surface cannot be updated, record the exact blocker and next action; do not claim synchronization.
3. Refresh the PR body with its own scope, actual base/parent, tested code revision, evidence and remaining acceptance. Child-branch evidence does not establish parent or integrated behavior until integration and revalidation.
4. Keep merge, foundation selection, guidance admission and real-data authorization as distinct review gates. A reviewable artifact does not authorize its adoption. A merge does not by itself complete an epic or select an implementation.
5. Before closure or supersession, map unique code, tests, fixtures, docs, results and CI to retained destinations or an explicitly accepted disposition. Keep source refs and links until that map is reviewed.

## Classification and active work

Use one primary `area:` label and a work type (`bug`, `enhancement`, `documentation`, `kind:epic` or `kind:experiment`); select an outcome milestone without inventing a date. Use the existing organization Priority field rather than creating a duplicate: High for the current path, Medium for next scoped work, Low for later work; reserve Urgent for exceptional blockers. Ready/active leaf work needs an accountable person and verified prerequisites; In review needs an inspectable artifact and a stated review question. Keep deferred work Backlog and tracking epics separate from daily leaf-task execution. Use `needs:decision` only when a concrete artifact/question is ready for a human decision.

## Completion and verification

A coding slice is handed off only when its issue, PR and Project state have been verified by readback, or the exact synchronization blocker and next action are recorded. Re-run checks affected by changed behavior, configuration or base; a documentation or label-only change does not require unrelated model or test runs. Report the exact head/base for checks and distinguish offline, scripted-browser, live-model and human observations.

Issue and PR templates collect only the short context needed to start and review work. Keep this procedure here instead of copying its full checklist into every template. Keep intermediate commits reviewable, and leave incomplete delivery in draft. Keep merge and foundation choices at their recorded decision gates.

## Read-only organization check

Run `node scripts/audit-project-organization.mjs` with Node and authenticated `gh`, or use `--snapshot PATH` for a captured JSON/directory. This is an optional maintainer tool, not an application runtime dependency. It reads GitHub and emits review warnings; it never updates the board. Warnings use structural/wording heuristics and cannot establish implementation quality, evidence truth, workflow configuration or merge readiness. Private Project access is required for live checks; record unavailable sources explicitly. No scheduled workflow or broader token grant is introduced by this check.
