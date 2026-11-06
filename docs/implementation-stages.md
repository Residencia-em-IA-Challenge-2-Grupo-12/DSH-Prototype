# Collaborative study demo: implementation stages

This is a working plan for a **synthetic, single-user demonstration**, not a production deployment commitment. GPT-6 Luna is the only authorized harness model until the user changes that preference. Calendar, files, feedback and conversations in the demonstration must remain fictional. Each stage should be reviewed as a working result, and its tests should distinguish deterministic checks from model behavior.

## 1. Make calendar state legible — in progress

Show a navigable week with existing events and pending additions/removals visually distinguished; retain the separate approval controls and revalidation. The current day-column overview groups events by start date; it is not a proportional time grid, and spanning or recurring events need additional handling. It is not a conversational agent view.

**Done when:** a reviewer can inspect both the current state and an unapplied proposal for either fixture, navigate weeks, and distinguish approval status without confusing previews with writes. Validate localized labels and calendar changes, including partial and stale state.

## 2. Prove the programmatic DSH boundary

Run the pinned DSH SDK profile with the study MCP tools and the user's already-authorized Codex subscription route. Keep the GPT-6 Luna selection explicit. Verify session events, one native question and its answer, cancellation, and session recovery without browser automation. The pinned install contains the SDK server/protocol, but the SDK client is not installed, and the subscription plugin is installed in the web profile only. Verify composition and credential access without copying credentials; do not assume profile compatibility.

**Done when:** a small reproducible synthetic run can be driven from a local client with a captured, sanitized trace and no unrelated model calls. Record blockers and actual tool failures.

## 3. Deliver one collaborative vertical slice

Connect a conversation and week view to the same session and proposal state. Have the agent read a selected syllabus and calendar, ask a meaningful question, show a proposed week, incorporate a user's change, and request separate review. Re-read the calendar and apply only the section explicitly approved. Show pending, stale, partial and applied states; record sources, decisions, and changes. Do not treat the deterministic planner as an agent response or silently turn a question into approval.

**Done when:** a person can complete the whole workflow in one interface and tests show rejected, absent and stale approval produce no writes. A live Luna run verifies the conversation; deterministic tests independently verify boundaries.

## 4. Package the stack and isolate execution

Use pinned container images and a Compose development stack for the application, DSH, simulator, and their configuration. Run one disposable agent workspace per session with explicit CPU, memory, process and time limits, restricted mounts and network, no Docker socket, and credentials outside agent execution. Keep the approval/write authority outside that execution world. Test reset, cleanup, no cross-session access, denied host/secret access and denied unapproved network access. Evaluate Docker hardening and DSH's native sandbox versus gVisor/microVM or managed alternatives; document actual enforcement and compatibility rather than assuming Docker alone is sufficient.

**Done when:** a clean setup starts the stack, the collaborative slice works inside it, and isolation checks demonstrate the stated boundaries. No claim of production-grade isolation without a separate threat model and assessment.

## 5. Expand scenarios and evaluation

Add independent reduced-hours, new-conflict and changed-deadline checkpoints, preserve manual edits, report partial writes, and show optional feedback and deterministic metrics separately from agent interpretation. Record sanitized traces, model configuration, duration and available usage for live runs. Test English and Brazilian Portuguese and retain realistic synthetic fixtures.

**Done when:** the scenarios are repeatable, localized, reviewable and explicitly separate deterministic assertions from model-dependent behavior.

## 6. Explore real workspace and calendar integration

Compare local, user-provided cloud and provisioned workspace approaches, with explicit consent, identity and data boundaries. Validate Google Calendar's real API and OAuth using a dedicated authorized test account only after simulator behavior and security boundaries are reviewed. Test time zones, recurrence, concurrent edits, partial failures and provider permissions. Evaluate whether existing calendar/GenUI plugins can be adapted, and document compatibility or a concrete replacement.

**Done when:** a recommendation records tradeoffs, integration tests, known gaps and a migration path; production access remains a separate decision.

## Decisions that remain open

- DSH-native UI plugin versus our own UI using the SDK; compare a working question and calendar review in both before committing.
- Docker-only isolation versus an additional kernel or VM boundary; choose against the actual threat model and workload.
- Local versus bring-your-own-cloud versus provisioned workspace; avoid coupling the prototype to one before evaluating data access and privacy.
- The agent's ability to shape proposals versus a deterministic scheduling tool; preserve visible assumptions and human review either way.
