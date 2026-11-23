# Optional check-ins across planning revisions

Observed 23 November 2026 in Chrome at source commit `33eba29f6d648623e01dbb06f4e02e60e3d53cc9`. Live model runs used GPT‑6 Luna through the existing host DSH route and fresh pinned Calendarpit instances. The English joined, skipped, conflicting and Brazilian Portuguese cases also ran with scripted outputs and an in-memory calendar.

| Case | What the operator saw | Verified outcome |
| --- | --- | --- |
| Skipped | Optional prompt, followed by the ordinary second-week preview | Zero model turns, notes, revisions or availability questions. Four hours in both weeks, with the fixture allowing one Friday hour in the first and two in the second. |
| Conflicting | The confirmed restriction and newly proposed flexible preference together, with both original replies | A three-hour preview with Friday free stayed active while the replacement was pending. A stale confirmation failed. Explicitly confirming the replacement gave a four-hour preview with one Friday hour. |
| Brazilian Portuguese | Review, calendar option labels, and question widget in pt-BR | Luna classified the initial wording as soft where the authored expectation was unknown. It preserved the date and supplied no fallback. After clarification and confirmation, the operator saw three hours with Friday free versus four hours with a Friday hour. Choosing the former affected the first week only. |

Both live runs preserved all 108 original events, then archived and verified retirement. They each used two model turns with unavailable usage data. The scripted Portuguese path additionally verified that an explicitly unknown interpretation is rejected at confirmation. The interface copy was in Brazilian Portuguese and kept event titles in the source fixture language. In both reviewed cases, expiry returned the next preview to four hours with two on Friday while keeping the source text visible in the run history.

- [Conflicting feedback in Chrome](evidence/follow-up/conflict-review.png) · [live trace](evidence/follow-up/conflicting-live.json) · [scripted trace](evidence/follow-up/conflicting-scripted.json)
- [Portuguese options in Chrome](evidence/follow-up/portuguese-options.png) · [live trace](evidence/follow-up/portuguese-live.json) · [scripted trace](evidence/follow-up/portuguese-scripted.json)
- [Skipped trace](evidence/follow-up/skipped-scripted.json) · [original flow regression](evidence/follow-up/joined-scripted.json)

## Storage decision for review

| Option | Tradeoff |
| --- | --- |
| Store the whole conversation | High audit detail and more people, places or personal details to retain and remove |
| Store only the latest preference | Small footprint and no way to tell what was reviewed, superseded or expired |
| Store reviewed versions with a source reference | A compact record that keeps a human decision trace. Source text can follow a separate retention and deletion policy. |

Start the next experiment with the third option. In a managed synthetic run, save a confirmed preference version with its strength, dates, allowed fallback, source reference and confirmation time. Link superseding versions and record which version each plan used. Keep ordinary notes and pending interpretations available within the run. Retain original notes across runs only with an explicit retention choice. Absence of feedback leaves no preference record. Expiry stops a preference from shaping new plans and remains visible in review. Ask explicitly before reusing it for a new period.

A restart-and-resume exercise is the next technical check. Verify that a confirmed time-bound preference is still enforceable and inspectable after restart, that a pending conflict cannot replace it, and that expiry survives restoration. Then check with a person whether the distinction is clear without facilitator guidance. This experiment used scripted operator actions and one fixture, so evidence for independent interpretation of the screen, multi-persona behavior, durability and a way to dismiss a pending replacement remains open.

## Restart follow-up

[Recovering a reviewed preference](PERSISTENCE.md) records the completed synthetic storage trial and the remaining human review and retention decisions.

## Reproduce

```sh
node experiments/checkin-preference/walkthrough.mjs --scripted /tmp/study-skipped skipped
node experiments/checkin-preference/walkthrough.mjs --scripted /tmp/study-conflicting conflicting
node experiments/checkin-preference/walkthrough.mjs --scripted /tmp/study-portuguese portuguese
```

Use a fresh output directory each time. The scripted scenarios run in browser CI without a model. For fresh model evidence, use `--live` and the [existing Luna setup](../../docs/host-luna-preview.md).
