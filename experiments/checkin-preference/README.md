# A check-in that changes the next plan

This synthetic Ana walkthrough connects the two pieces tested in [the routine-preference experiment](../routine-preference/README.md). Luna proposes an interpretation of the check-in. The operator can inspect or correct it in the existing planning review. The shared rule and deterministic planner decide which feasible calendars to offer once the operator confirms a dated preference.

The adapter builds two successive calendar previews. It keeps original notes, interpretations and the selected preview as separate records. It uses the real question widget, checks option timing again against the calendar when a choice is submitted, and disables all approval controls for this exercise.

## What happened

| Moment | Study | Friday | What the operator saw |
| --- | ---: | ---: | --- |
| Starting week, Nov 2–8 | 4 h | 1 h | Usual plan before any feedback |
| After the note and before review | 4 h | 1 h | Original wording and Luna’s proposed interpretation |
| Confirmed soft preference, no accepted fallback | 3 h or 4 h | 0 h or 1 h | Both options on the calendar, one choice in the widget |
| Operator selected “Keep Friday free” | 3 h | 0 h | Updated preview for Nov 2–8 |
| Next week, Nov 9–15 | 4 h | 2 h | The notes remain in the review. The expired preference is no longer applied. |

All 108 existing Calendarpit events were unchanged in the completed Luna run, and the simulator and its writers were verified retired. Selecting a preview did not create an approval. The older revision ID was rejected after the operator sent a correction.

The opening note said Friday study “felt too demanding” and asked to reconsider that time. Our prepared interpretation was `unknown` because it left the desired rule unclear. Luna returned `soft` with the correct Nov 8 end date and no assumed fallback on all three attempts. The first script stopped on this difference. The second stopped after a browser-test race while awaiting the correction. The third exercised the complete flow with two model replies and logged the first interpretation as an observed disagreement. The operator's explicit correction also returned `soft` and left the fallback unset. The independent scripted run forced `unknown` and verified that it could not be confirmed until clarified. Model usage is unknown. A single fictional case gives evidence about the interaction, with little evidence about interpretation consistency or operator effort.

- [Original wording and proposed interpretation](evidence/1-interpreted.png)
- [Calendar options in the actual Luna run](evidence/2-tradeoff.png)
- [Second-week calendar after expiry in the scripted browser replay](evidence/3-expired-scripted.png)
- [Live attempts 1](evidence/luna-1.json), [2](evidence/luna-2.json), [3](evidence/luna-3.json) and [scripted check](evidence/scripted-3.json)

## Reproduce locally

Use the repository's pinned Node and the existing Chrome browser helper. Both exercises bind only to loopback and retire their synthetic run. Pick a fresh private output path. The live mode requires the existing approved host Luna profile and Docker with the pinned Calendarpit environment. Use the [host walkthrough setup](../../docs/host-luna-preview.md) for that profile. Credentials remain there.

```sh
node experiments/checkin-preference/walkthrough.mjs --scripted /tmp/study-checkin-scripted
node experiments/checkin-preference/walkthrough.mjs --live /tmp/study-checkin-luna
```

## Follow-up

[Skipped, conflicting, and Brazilian Portuguese check-ins](FOLLOW-UP.md) extends the original run with six browser runs and a storage recommendation.

## Original experiment options

| Option | What it buys | Cost or limit |
| --- | --- | --- |
| A form alone | Explicit strength, dates and fallback at entry | The operator has to translate their experience into those fields |
| Luna interprets and chooses | Open-ended collaboration in one conversation | The five-case experiment found that it could choose without permission or reopen a settled decision |
| Interpret, review, then apply the rule | Natural input, inspectable correction and reproducible expiry | One review step where a preference may affect the plan |
| Introduce persistent preference memory immediately | Reuse across runs and devices | Requires a retention and migration decision before we know which records and controls are worth keeping |

The third option is the current experiment. Read the results before adding durable records. The first walkthrough used an English Ana case, local-only controls, a fixed clock, one topic and run-local state. The note describes a fictional earlier week and the preference applies to a separate planning period. It records the user’s wording without measuring well-being, assigning a numerical health score or deducing fatigue. The follow-up covers ambiguity in Portuguese, leaving the check-in unanswered, and a conflict with an already confirmed preference. Session-level feedback and deletion or retirement controls remain open. A free-text reply inside the schedule-choice widget is outside the exercised path. Calendar writes, general-purpose preference memory, and changes to the planner are outside this adapter.

Track the optional-feedback workflow in [#5](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/5), broader adaptation in [#14](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/14) and any structured well-being evaluation in [#15](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/15). The separate planner comparison in [#45](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/45) still needs to be run against both solvers.
