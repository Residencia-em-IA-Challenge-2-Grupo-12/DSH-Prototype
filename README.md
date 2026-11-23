# Study Atlas — synthetic study-planning demo

**English · [Português](README.pt-BR.md)**

> **Experimental draft with bounded live evidence.** Calendar-write recovery remains incomplete, including after a process crash or delayed provider response. Use only disposable synthetic data. See [recovery status](docs/recovery-work-in-progress.md). GPT-6 Luna remains the default route. One bounded comparison is separately authorized for `deepseek/deepseek-v4.1-flash-1017` through the official DeepSeek provider on OpenRouter, with fallback disabled and a shared approximate $5 target for setup, agent and evaluator calls. That paid route is currently disabled pending verified pricing, egress and accounting; it is not a model default. See [model setup](docs/models.md) for the routing boundary.

The verified experimental baseline is on `main` (closed out in [baseline-closeout-2026-11-22.md](docs/review/baseline-closeout-2026-11-22.md)). Start with [docs/STATUS.md](docs/STATUS.md) for current priorities, active work, and the portable foundation roadmap ([docs/foundation-roadmap.md](docs/foundation-roadmap.md)). Developers can run the [calendar checkpoint replay](docs/calendar-replay.md) or the [portable study-planning replay](docs/paired-replay.md).

Current local Luna browser route: [verified launch and approval instructions](docs/host-luna-preview.md). The managed carrier and host fallback have different guarantees; see the [baseline closeout](docs/review/baseline-closeout-2026-11-22.md) and historical [readiness report](docs/review/onboarding-readiness-2026-11-17.md).

Study Atlas explores a collaborative study assistant using DeepSeek Harness (DSH), two synthetic student workspaces and a local Calendarpit calendar. The companion interface drafts near-term and future study blocks, reviews them separately, records optional feedback, compares checkpoint snapshots and displays a routine summary.

The sample planner is deterministic. DSH can call the MCP tools and add an explanation when a model is configured; a live model run is **not** the same as the deterministic test. No real Google account or real user documents are needed.

## Prerequisites

- Docker and Docker Compose; Node.js/npm for installation; `pdftotext` (Poppler).
- The pinned DSH release requires Node 24.9 or later. The npm install supplies a project-local Node 24 binary; it does not replace your system Node.
- A model provider/API key or compatible self-hosted endpoint is optional for the offline preview and tests.

## Current group demonstration

Use the [bilingual onboarding package/build guide](docs/onboarding/README.md) and [self-sufficient facilitator checklist](docs/onboarding/facilitator-checklist.md). The current interactive demonstration is `http://127.0.0.1:4176/` on the facilitator computer, using the explicitly labeled host Luna fallback. It has one disposable authoritative run, Google-compatible simulator access with synthetic OAuth and separate near/future review. The [readiness report](docs/review/onboarding-readiness-2026-11-17.md) states what was actually tested and what remains incomplete.

## Legacy prototype start

The following port 4174 management-API workflow is retained for historical/prototype features such as feedback/report forms. It is a separate entry point, not the current disposable group walkthrough; do not use its reset/admin operations to manipulate a managed run.


```bash
npm install
docker compose up -d
npm start
```

Open http://127.0.0.1:4174. The companion server binds all interfaces for a LAN preview and contains no authentication; expose it only on a trusted network. Calendarpit's administration and test API is loopback-only at http://127.0.0.1:4173. Both contain synthetic data only.

For the **Collaborate** tab's live agent, first follow [model setup](docs/models.md), including the user's Codex sign-in, and install the same pinned plugin in the SDK profile with `npm run install:codex-plugin:sdk`. Open the companion at `http://localhost:4174` or `http://127.0.0.1:4174` on the development machine: model-control endpoints reject LAN and Tailscale clients because this preview has no authentication. GPT-6 Luna is the default route. The bounded DeepSeek comparison route is not enabled in this runnable path. Agent conversations are in memory and do not resume after restarting the companion.

In a second terminal, start the project-isolated DSH web profile:

```bash
npm run dsh:study
```

Use the local URL printed by DSH, select a model provider and a synthetic workspace under `.runtime/workspaces/`, and ask it to inspect the student’s syllabi and calendar using the `mcp__study__*` tools. Start the companion and reset a student first. DSH maintains its own token-protected interface. The MCP server can propose but does not expose an approval or calendar-write tool.

See [model setup](docs/models.md) before configuring a subscription, API provider or self-hosted endpoint. No model request is made during the offline tests.

## Legacy prototype walkthrough

1. Pick Ana or Bruno and **Reset scenario**. Browse the synthetic workspace and read a syllabus.
2. In **Collaborate**, ask the agent to plan, answer its questions and request revisions; the calendar and proposal update alongside the conversation. Alternatively, create a deterministic proposal in **Study plan**. Nothing is written to the calendar at this stage.
3. Review and approve the coming week. Future tentative blocks require a separate approval.
4. Add optional feedback, generate a report, or edit the synthetic calendar in Calendarpit's admin UI. Run a checkpoint to inspect changes, and create a revised proposal.
5. On the Calendar tab, preview and approve an event category annotation. Existing event description text is preserved.

The Calendar tab also shows a navigable seven-day overview of existing events and pending additions/removals. It groups events by their start date; it is not a proportional time grid and does not yet expand recurring or multi-day events. Proposals are previews until separately approved in Study plan.

Fixtures use a fixed simulated date, 2026-11-02, and the São Paulo time zone. Ana has a four-week deadline; Bruno has a six-week deadline. Scheduled time is not evidence of completed work.

Ana's first week includes 20 hours of part-time work and 9 hours of classes. Bruno's includes 40 hours of work and 9 hours of classes; their study windows are different. Both fixtures contain six weeks of explicit fictional events and a second-week exception. These are illustrative routines, not claims about an average or a healthy workload. The planner uses the stated study windows and pauses between blocks; without stated windows it reports a shortfall rather than treating a blank calendar as free time. Study-window changes and real calendar recurrence remain future work.

## Checks and legacy integration

```bash
npm test
npm run test:integration  # Calendarpit must already be running; resets Ana's synthetic calendar
```

The offline tests cover three independent checkpoint scenarios, approval and stale-state checks, user edits, partial failures, feedback, report calculations, MCP discovery and translation-key parity. The integration test exercises the actual Calendarpit management API. It does not establish Google OAuth or real-provider compatibility.

## Legacy prototype boundaries and shared limits

- Calendarpit is a **preview** that simulates a subset of Google Calendar. This prototype uses its local management endpoints rather than the authenticated Google-compatible API. Real OAuth, email invitations and Google-specific edge cases remain untested.
- The calendar and shared runtime are single-user demonstration resources; switching student resets the simulator. Do not connect real accounts or put private files in the fixtures.
- The model-facing MCP interface has no calendar-write or approval tool. The companion approval API performs writes, but Calendarpit's own administration API and generic DSH capabilities are reachable to local processes. **This is not a security boundary against an untrusted agent**; independently enforce tool/network isolation before using real data.
- The parser recognizes simple dates in the bundled syllabi, and the planner uses one-hour slots in stated study windows, fictional daily limits and breaks, a fixed São Paulo offset and heuristic categories. Missing windows are not treated as free time. This is not an optimizer, a health assessment or proof of effective learning.
- Conversational revisions can prefer morning, afternoon or evening and avoid named dates within the fictional student’s recorded study windows; they cannot yet express every constraint or precisely drag an individual block. The preferred period can fall back to other recorded windows when needed. A model may ask ordinary follow-up messages or native form questions.
- User-edited study events are protected from automatic replacement when a checkpoint or draft observes the edit. Partial writes are reported, not rolled back automatically.
- Markdown/JSON reports are written to ignored `.runtime/`; a model can supply an interpretation via MCP. A report created without one explicitly says so.

See [integration findings](docs/integrations.md), [study and memory research](docs/research.md), [architecture and fixtures](docs/architecture.md), and [Portuguese setup](README.pt-BR.md).

The [implementation stages](docs/implementation-stages.md) describe the remaining collaborative interface, SDK, containerization, isolation, and provider work.

Stop the companion and DSH with Ctrl-C in their terminals; stop the simulator with `docker compose down`. These processes do not automatically restart after reboot.
