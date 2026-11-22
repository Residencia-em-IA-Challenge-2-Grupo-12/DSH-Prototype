# Study-planning regression tests

| Check | Runs | Verifies |
|---|---|---|
| Offline suite and onboarding build | PR updates and pushes | Fixture integrity, schema compatibility, reviewed scheduling constraints, approval rules, UI state helpers and package links. |
| Calendar replay integration | Relevant pull request changes and `main` pushes. Can also run manually. | One scripted Bruno case using a fresh Calendarpit. The revised plan passes independent validation, five near events match the approved proposal, future events stay pending, and retirement is verified. |
| Scripted browser review | Relevant browser, application or fixture changes. Can also run manually. | Chrome renders the question and calendar, handles an option that becomes busy, shows the revision, rejects stale approval and applies only the reviewed coming week after a new proposal. The browser uses an in-memory synthetic calendar. |
| Extended calendar recovery | Manually run the replay workflow with **Also exercise stale, duplicate and uncertain writes**. | Provider acceptance, independent observation, and refusal to retry a lost response. Both available and unavailable observations are covered. |
| Live Luna walkthrough | Deliberate evaluation of model, prompt or evidence-tool changes. | Questions, source choice, revisions and the quality of explanations for an operator. Use fictional data and the existing authorized local profile. |

The hosted jobs keep replay JSON and scripted Chrome evidence as workflow artifacts. They use authored turns and require no model credentials. The workflows run on pull request updates for their declared paths. Merges to `main` rerun the applicable jobs against the integrated code. A document-only change still runs the ordinary offline workflow.

## Run locally

Use the pinned Node version and installed dependencies. The replay requires Docker. The browser command requires Chrome. Python is optional for inspecting the portable result.

```sh
./node_modules/.bin/node tests/browser-review/scripted.mjs "$(mktemp -d /tmp/study-browser-check-XXXXXX)"

out=$(mktemp -d /tmp/study-replay-check-XXXXXX)
./node_modules/.bin/node scripts/paired-replay.mjs pack bruno "$out/bruno"
for scenario in success stale duplicate unknown unknown-unavailable; do
  ./node_modules/.bin/node scripts/paired-replay.mjs run "$out/bruno" "$out/$scenario.json" "$scenario"
  python3 scripts/paired-replay-probe.py --check-result "$out/bruno" "$out/$scenario.json"
done
```

## Add a regression from a live run

Keep the run and dated observations. Put measured facts into a small offline or scripted test when they have a stable answer. For example, Ana’s published deadline is 1 December 2026 at 17:30 São Paulo time. A one-date correction excludes 4 November and retains 11 November as an available candidate subject to that day’s commitments. The existing narration check compares reviewer-labeled claims with pinned schedule blocks. New valid schedules may allocate time differently within their reviewed constraints.

Review question usefulness and the clarity of explanations in the live trace. The planned schedule, confirmed inputs, and provider observation are separate evidence. A case whose outcome informs a fix becomes a regression case. Keep another unseen case for the next generalization test.
