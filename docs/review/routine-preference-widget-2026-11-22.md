# Reviewed preference rule in the question widget · 22 November 2026

The shared rule passed all four browser checks with fresh Ana scenarios. It chooses whether to ask from a reviewed preference, its dates and any explicit fallback. The same function now drives the earlier form control. The existing question renderer displays the choices with their calendar intervals. When the selected slot becomes busy, the existing managed answer check rejects it before accepting a choice.

| Chrome case | Verified outcome |
| --- | --- |
| Current preference, fallback undecided | Showed one question comparing 3 h with Friday free and 4 h with 1 h on Friday. The operator selected the four-hour schedule for review. |
| One Friday hour explicitly allowed | Recommended the four-hour candidate with one Friday hour and skipped the widget. |
| Previous preference expired | Used the ordinary four-hour candidate and skipped the widget. |
| New event after the question | Rejected the selected Friday option, marked its interval busy, and allowed the remaining three-hour choice. |

[Question and calendar overlay](../evidence/routine-preference-widget-2026-11-22/choose-friday.png) · [Stale option shown as busy](../evidence/routine-preference-widget-2026-11-22/late-conflict.png) · [Machine-readable browser record](../evidence/routine-preference-widget-2026-11-22/browser.json).

The first test looked for a policy nickname even though the ordinary schedule happened to use exactly one Friday hour. The tested revision labels the question choice by its actual time impact. The fresh browser check then passed. The browser used the application’s real companion page, managed HTTP and answer-time calendar checks, with reviewed fixture records and an in-memory synthetic calendar. The selection was a review decision. No approval was invoked and all existing events were preserved.

## Live Luna checks

Separately, four fresh synthetic Ana sessions exercised GPT-6 Luna on the existing DSH host route at 8a8cff7b61122044247efaef2faa2f462b0fa76e. The interpretation task used a fictional statement and the disclosed dates. An explanation task used the rule’s actual four-versus-three-hour choice from the browser test.

- Both current preferences matched the reviewed record, including whether a 60-minute fallback existed.
- For the expired record, Luna extracted the correct dates and no fallback, but returned hard where the fixture records soft. The fictional statement asked to protect time without spelling out the strength. The extractor required hard or soft and supplied no unknown option. Keep ambiguous strength open when it matters. The deterministic rule ignores an expired record before inspecting its strength.
- Luna phrased the supplied choice in English with both totals and Friday impacts. It left the choice with the user.

All replies parsed as JSON, used zero tools and preserved all 108 calendar events per run. Each run was archived and retired. Usage was unavailable. [Exact live packets and replies](../evidence/routine-preference-widget-2026-11-22/luna.json).

## What this supports

The test separates choosing whether to ask from interpreting language. It exercised the widget with reviewed inputs and separately measured the model’s handling of a short statement. We have evidence for the two seams. The live interpretation has yet to enter the widget through a user review step.

The next scoped #5/#14 test can make that join. Take one optional dated check-in, show the proposed preference with its source, scope and any unresolved strength, and let the user confirm or correct it. Apply the reviewed preference to a second synthetic plan and verify expiry. Keep the old report inspectable even after its planning preference expires. Measure the resulting decision and the effort to review it separately.

All 194 offline tests and the bilingual package build passed. Run the four Chrome checks from this branch with pinned dependencies:

    node experiments/routine-preference/widget-browser.mjs "$(mktemp -d)"
