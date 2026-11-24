# Portable HTTP Runner Contract (`http-runner-v1`)

This contract separates the **harness-agnostic Foundation** (frozen bundles, isolated Calendarpit, SQLite write claims, fault injection, and deterministic schedule/approval oracle) from **pluggable agent runners**:

- **Approach A (Hardcoded multi-agent pipeline):** e.g., StudyBuddy FastAPI (`Maestro → Research → Analysis → Validation → Communication`, `#47`).
- **Approach B (Single tool-using agent):** DSH single-agent or a plain non-DSH tool loop.
- **Approach C (Runtime-defined delegation):** Lead agent with bounded read-only workers (`#48`).

## Running an external HTTP runner

```sh
./node_modules/.bin/node scripts/paired-replay.mjs pack bruno /tmp/bruno-bundle
./node_modules/.bin/node scripts/paired-replay.mjs run /tmp/bruno-bundle /tmp/result.json success \
  --runner-url http://127.0.0.1:8000/replay \
  --engine-name "StudyBuddy pipeline (scripted)"
python3 scripts/paired-replay-probe.py --check-result /tmp/bruno-bundle /tmp/result.json
```

All five safety scenarios (`success`, `stale`, `duplicate`, `unknown`, `unknown-unavailable`) run unchanged against any conforming runner. Runner URLs must be loopback `http://`.

## Endpoints implemented by the external runner

| Method & Path | Request JSON | Response JSON |
| --- | --- | --- |
| `POST /sessions` | `{ version: 1, runId, caseId, student, locale, clock, sources, toolBridge: { url, token, methods } }` | `{ sessionId, engine?: { name, revision, mode, model, harness }, usage? }` |
| `POST /sessions/:sessionId/prompt` | `{ text }` | `{ messages, question, busy, error, usage? }` |
| `POST /sessions/:sessionId/answer` | `{ requestId, answers }` | `{ messages, question, busy, error, usage? }` |
| `POST /sessions/:sessionId/cancel-question` | `{ requestId }` | `{ messages, question, busy, error, usage? }` |
| `GET /sessions/:sessionId/snapshot` | — | `{ messages, question, busy, error, usage? }` |
| `DELETE /sessions/:sessionId` | — | `{}` (best-effort cleanup) |

### Snapshot shape
```json
{
  "messages": [{ "type": "user", "text": "..." }],
  "question": {
    "requestId": "availability",
    "questions": [{ "id": "availability", "question": "...", "options": [] }]
  },
  "busy": false,
  "error": null
}
```
Set `"question": null` when no user clarification is pending.

## Trusted Tool Bridge (called by the runner)

For each run, the Foundation starts an ephemeral loopback bridge at `toolBridge.url` protected by header `x-study-run-token: <toolBridge.token>`.

- **Request:** `POST <toolBridge.url>` with `{ "method": "<tool_name>", "args": { ... } }`
- **Allowed methods (derived dynamically from `StudyBoundary`):** `list_synthetic_files`, `read_synthetic_file`, `list_calendar`, `read_planning_context`, `propose_planning_context`, `draft_study_plan`, `preview_study_options` (plus `inspect_checkpoint`, `routine_report`, `save_report_interpretation`).
- **Compact `list_calendar` projection:** `StudyBoundary` projects agent-facing calendar events to `{ id, summary, start, end }` plus non-default `status`/`transparency`, `description`, `location`, and `{ studyBlock: true, course }` for Study Atlas demo blocks. This reduces calendar tool payload size by ~61–62% on the Bruno and Ana fixtures while keeping internal planner and diffing logic on raw calendar records.
- **Forbidden:** Calendar writes, approvals, and resets are absent from the bridge and return `403`. Only the trusted Foundation operator confirms context and approves calendar writes.

## Multi-turn & Live Runner Notes (for Slice 3 Runners)

- **Grouped and sequential questions:** `runner.mjs` answers any pending `question.questions` array in one `POST /sessions/:id/answer` call and loops across follow-up question turns (up to `maxQuestionTurns = 8`). Questions are matched to `manifest.operator.answers` first by exact `id`, then by topic keywords (`availability`, `workload`, `preparation`), and finally by next unused prepared answer.
- **Locale-aware draft prompt:** After confirming a pending planning context revision, `runner.mjs` sends the locale-matched draft prompt (`pt-BR` or `en`) unless the runner has already drafted a new plan revision.
- **Dynamic stale-write target:** In the `stale` scenario, `runner.mjs` selects a non-study week-1 commitment relative to `manifest.clock.date` rather than assuming a fixed date.
- **Expected Slice 3 runners:**
  1. **Standalone non-DSH single-agent runner (included):** `scripts/single-agent-runner.mjs` runs a plain OpenAI-compatible tool-calling loop over `http-runner-v1` with zero dependency on `@deepseek-ai/dsh` or `@modelcontextprotocol/sdk`. It supports `--schema-compat standard|gemini` (stripping `additionalProperties` for Google's OpenAI-compatible Gemini endpoint) and `--reasoning-effort none|minimal|low|medium|high|xhigh`:
     ```sh
     # Via local OpenRouter budgeted gateway:
     STUDY_RUNNER_API_KEY=... ./node_modules/.bin/node scripts/single-agent-runner.mjs \
       --base-url http://127.0.0.1:4179/v1 --model deepseek/deepseek-v4.1-flash-1017 --port 4180

     # Via Google's OpenAI-compatible Gemini endpoint:
     STUDY_RUNNER_API_KEY=... ./node_modules/.bin/node scripts/single-agent-runner.mjs \
       --base-url https://generativelanguage.googleapis.com/v1beta/openai \
       --model gemini-4-hydrogen --schema-compat gemini --reasoning-effort low --port 4180

     ./node_modules/.bin/node scripts/paired-replay.mjs run /tmp/bruno-bundle /tmp/result.json success \
       --runner-url http://127.0.0.1:4180 --mode live
     ```
  2. **StudyBuddy FastAPI `/replay` adapter (`#47`):** implements the same 6 endpoints above in Python FastAPI and connects via `--runner-url`.

