# Study Atlas — synthetic study-planning demo

**English · [Português](README.pt-BR.md)**

Study Atlas explores a collaborative study assistant using DeepSeek Harness (DSH), two synthetic student workspaces and a local Calendarpit calendar. The companion interface drafts near-term and future study blocks, reviews them separately, records optional feedback, compares checkpoint snapshots and displays a routine summary.

The sample planner is deterministic. DSH can call the MCP tools and add an explanation when a model is configured; a live model run is **not** the same as the deterministic test. No real Google account or real user documents are needed.

## Prerequisites

- Docker and Docker Compose; Node.js/npm for installation; `pdftotext` (Poppler).
- The pinned DSH release requires Node 24.9 or later. The npm install supplies a project-local Node 24 binary; it does not replace your system Node.
- A model provider/API key or compatible self-hosted endpoint is optional for the offline preview and tests.

## Start

```bash
npm install
docker compose up -d
npm start
```

Open http://127.0.0.1:4174. The companion server binds all interfaces for a LAN preview and contains no authentication; expose it only on a trusted network. Calendarpit's administration and test API is loopback-only at http://127.0.0.1:4173. Both contain synthetic data only.

In a second terminal, start the project-isolated DSH web profile:

```bash
npm run dsh:study
```

Use the local URL printed by DSH, select a model provider and a synthetic workspace under `.runtime/workspaces/`, and ask it to inspect the student’s syllabi and calendar using the `mcp__study__*` tools. Start the companion and reset a student first. DSH maintains its own token-protected interface. The MCP server can propose but does not expose an approval or calendar-write tool.

See [model setup](docs/models.md) before configuring a subscription, API provider or self-hosted endpoint. No model request is made during the offline tests.

## Walkthrough

1. Pick Ana or Bruno and **Reset scenario**. Browse the synthetic workspace and read a syllabus.
2. Create a proposal. Nothing is written to the calendar at this stage.
3. Review and approve the coming week. Future tentative blocks require a separate approval.
4. Add optional feedback, generate a report, or edit the synthetic calendar in Calendarpit's admin UI. Run a checkpoint to inspect changes, and create a revised proposal.
5. On the Calendar tab, preview and approve an event category annotation. Existing event description text is preserved.

The Calendar tab also shows a navigable seven-day overview of existing events and pending additions/removals. It groups events by their start date; it is not a proportional time grid and does not yet expand recurring or multi-day events. Proposals are previews until separately approved in Study plan.

Fixtures use a fixed simulated date, 2026-11-02, and the São Paulo time zone. Ana has a four-week deadline; Bruno has a six-week deadline. Scheduled time is not evidence of completed work.

## Checks

```bash
npm test
npm run test:integration  # Calendarpit must already be running; resets Ana's synthetic calendar
```

The offline tests cover three independent checkpoint scenarios, approval and stale-state checks, user edits, partial failures, feedback, report calculations, MCP discovery and translation-key parity. The integration test exercises the actual Calendarpit management API. It does not establish Google OAuth or real-provider compatibility.

## Boundaries and limitations

- Calendarpit is a **preview** that simulates a subset of Google Calendar. This prototype uses its local management endpoints rather than the authenticated Google-compatible API. Real OAuth, email invitations and Google-specific edge cases remain untested.
- The calendar and shared runtime are single-user demonstration resources; switching student resets the simulator. Do not connect real accounts or put private files in the fixtures.
- The model-facing MCP interface has no calendar-write or approval tool. The companion approval API performs writes, but Calendarpit's own administration API and generic DSH capabilities are reachable to local processes. **This is not a security boundary against an untrusted agent**; independently enforce tool/network isolation before using real data.
- The parser recognizes simple dates in the bundled syllabi, and the planner uses simplified one-hour slots, fixed São Paulo offset and heuristic categories. This is not an optimizer, a health assessment or proof of effective learning.
- User-edited study events are protected from automatic replacement when a checkpoint or draft observes the edit. Partial writes are reported, not rolled back automatically.
- Markdown/JSON reports are written to ignored `.runtime/`; a model can supply an interpretation via MCP. A report created without one explicitly says so.

See [integration findings](docs/integrations.md), [study and memory research](docs/research.md), [architecture and fixtures](docs/architecture.md), and [Portuguese setup](README.pt-BR.md).

The [implementation stages](docs/implementation-stages.md) describe the remaining collaborative interface, SDK, containerization, isolation, and provider work.

Stop the companion and DSH with Ctrl-C in their terminals; stop the simulator with `docker compose down`. These processes do not automatically restart after reboot.
