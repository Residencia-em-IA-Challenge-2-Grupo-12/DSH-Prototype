# Cold-start planning exercise

The exercise stages a separate fictional workspace and keeps an empty planning context in a private run database. The operator can work through it locally with the existing GPT-6 Luna subscription. It uses the same native DSH question protocol as the companion. The terminal renders numbered choices, multi-select and typed answers. The existing browser companion remains the reference for its graphical widgets.

## Run a case

Install the repository dependencies and ensure local Docker, the pinned Calendarpit image and `pdftotext` are available. From the repository root, use the absolute path to the existing trusted Luna profile and choose a new evidence directory.

```sh
mkdir -p .runtime/cold-start
STUDY_LUNA_DSH_HOME=/absolute/path/to/local/dsh-profile \
  ./node_modules/.bin/node scripts/run-cold-start.mjs bruno .runtime/cold-start/bruno-first
```

Start with an ordinary study-planning request in the persona's language. Give the operator card to the facilitator only. A scripted operator may use the same authored answers when a question actually calls for them. Record skipped questions and unknown facts. Enter one option number, comma-separated numbers for a multi-select question, or the answer in your own words. Use `:skip` if the persona cannot answer.

The agent proposes cited deadlines and a normalized set of preferences. Inspect the exact pending revision and use `:confirm <revision ID>` when it matches what the operator intended. Ask the agent to revise the record if it differs. After confirmation, ask for a draft. Use `:show` to inspect the plan and the approved context, then `:new` to open a new conversation in the same exercise and test reuse. Finish with `:quit`. The CLI checks observed events against the initial calendar and retires the simulator. Inspect `result.json` and the synthetic trace in the selected evidence directory. If cleanup is unverified, inspect only resources labelled with the recorded run ID.

## Fixture matrix

| Case | Documents visible to agent | What to inspect |
|---|---|---|
| `bruno` | Two-page August PDF with multiple dates, a later pinned exam change and a database-project rubric | Cite the updated exam time, 14 December at 09:00, and the project deadline, 14 December at 18:00. Use weekly availability as a candidate. |
| `bruno-text` | Same initial schedule in Markdown, same LMS notice and rubric | Compare the same facts in a different format. Treat both variants as one family in any evaluation split. |
| `ana` | Weekly activity table, draft review, submission opening, closing and feedback, plus a Statistics assessment register | Distinguish final submission on 30 November at 18:00 from intermediate dates. The classification guide leaves effort and method to Ana. |
| `ana-conflict` | Ana's sources plus a tile that gives an earlier deadline without provenance of supersession | Explain the mismatch and ask which date or source governs. Confirm the answer before drafting. |

### Operator cards

- **Bruno.** This week only, Wednesday 19:00–21:15, Saturday 14:00–16:15 and Sunday 10:00–12:15 work. Keep Monday free. Up to two study sessions a day with a 15-minute break. Five hours feels workable this week. There is no intrinsic course priority or known mastery level. If asked to protect Wednesday instead, four hours on the weekend is acceptable. Reveal the choice the question calls for.
- **Ana.** I have a dataset and notebook skeleton. I have yet to train or validate a baseline. For this week, Wednesday and Friday 14:00–16:15 work if free. Four hours, up to two sessions per day, with a 15-minute break. Leave further weeks open for discussion.
- **Ana conflict.** Use the same answers. Only if asked which source to trust, say the instructor confirmed the LMS closes at noon on November 30. Explain what was confirmed. Leave unsupported details unknown.

The fixtures stage course and assessment materials without a target, study windows or a machine-readable answer key. Operators decide when a cited deadline and preferences are ready for use. The service verifies that the excerpt exists at the cited location. The operator reviews whether it supports the normalized value. The review applies to the visible revision. A revised record invalidates a pending plan, and its preferences apply through the confirmed date.

The current planner schedules whole-hour blocks using a whole-hour target. The record applies to one disposable run, with reuse across new conversations inside it. The CLI exposes source/reference data and review state. A graphical context review panel, richer scheduling inputs and a real-user comparison remain separate work.

## Evaluation

The offline tests use authored case records to verify the planner and review boundary. A live exercise evaluates how the model finds sources, asks questions, adapts to the operator and reuses the saved record. Score those observations separately. Measure whether the operator can identify the authoritative deadline, spot material uncertainty and see the effect of a correction. Hold back whole persona families in later evaluations. Marina's changing shifts and caregiving and Ravi's temporary preference override are useful reserved cases.

```sh
./node_modules/.bin/node --test --import ./tests/isolate-runtime.mjs tests/cold-start.test.mjs
```
