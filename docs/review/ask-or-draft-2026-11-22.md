# When to ask and when to draft · 22 November 2026

[Follow-up results with revised agent guidance](clarification-guidance-2026-11-22.md).

The experiment uses two fresh instances of the same synthetic Bruno calendar and source documents. It checks whether Luna asks when a real preference is missing, proceeds to input review when the request is complete, and makes a correction visible before any calendar approval. The existing planner, question widget and calendar review run from main at 15d5139. The operator used prepared fictional replies in headless Chrome with the host Luna fallback and disposable Calendarpit. Each run was capped at four question widgets per turn by the operator. Luna usage was unavailable.

## Cases

Both requests cover 2–8 November 2026, four one-hour sessions, at most two per day, a 15-minute break and no assessment priority. Monday stays free. The source materials include an outdated Algorithms date superseded by a pinned notice and a separate Database rubric. The relevant dates are 14 December at 09:00 and 18:00, respectively.

| Case | Difference in the opening request | Useful behavior |
| --- | --- | --- |
| Complete | The user explicitly protects Wednesday. Saturday 14:00–16:15 and Sunday 10:00–12:15 are the study windows. | Submit the cited inputs for review. Four hours and the daily cap imply two sessions each day. |
| Preference missing | Wednesday 19:00–21:15 is also possible. Working late and using more of the weekend both have a cost. | Ask which to protect, with a clear consequence for the schedule. After the answer, submit the inputs based on that choice. |

A clear question could say, “Would you rather keep Wednesday evening free and use two hours on both weekend days, or use two hours Wednesday and Saturday and keep Sunday free?” Both choices respect the stated hard constraints in this fixture. The operator chose to protect Wednesday in the second case. The shared correction ends Sunday at 11:00 and reduces the target to three hours while keeping weekdays free. The operator confirms input revisions separately from approving calendar changes. The experiment withholds calendar approval and checks the provider-backed event list before retirement.

The first attempt used the UI's wording “coming week” in the follow-up request to draft. Both repeat cases use exact dates in that message after the ambiguity surfaced. The initial attempt stays in the evidence. Questions were answered via the typed option to convey the prepared reply. This observes the widget and schedule review using the real model. It does not measure human cognitive effort or compare model providers.

## Results

| Attempt | Question widgets / fields | Proposal and revision |
| --- | ---: | --- |
| Complete, first attempt | 2 / 2 | Correct input review. The subsequent “coming week” prompt was interpreted as 9–15 November. The scripted operator gave a noncommittal reply, and Luna withheld the draft. |
| Complete, explicitly dated repeat | 2 / 3 | Two fields repeated known inputs at opening, and a third repeated the correction. The plan went from four to three blocks. |
| Preference missing, explicitly dated | 2 / 2 | The first answer supplied a real preference. The second repeated known inputs. The plan went from four to three blocks. |

Both dated runs confirmed the intended source dates, planning windows and corrected workload before drafting. Each independently observed calendar retained all 146 original event records. Each simulator was verified retired. Elapsed browser time, including startup, review and retirement, was 71, 97 and 120 seconds respectively. [Run IDs, questions, verified windows and proposal records](../evidence/ask-or-draft-2026-11-22/summary.json).

## What the browser exposed

- **Complete request.** The pilot asked how to split the four sessions and offered 3+1 distributions in either direction. Either exceeds the user's stated daily cap. The calendar check established that the stated windows were clear, which leaves daily limits and the weekly target to check. Luna later read the course dates correctly and submitted the intended four-hour inputs. In the dated repeat, it asked two already-answered questions in one widget, then asked the user to reconfirm their explicit Sunday correction. [Redundant question and invalid options](../evidence/ask-or-draft-2026-11-22/redundant-question.png).
- **Preference missing.** The first question acknowledged that working late and using the weekend each came at a cost, then asked the operator to choose four slots while listing two checked slots. The tool checked Saturday 10:00–11:00 against class, even though the operator had offered Saturday afternoon. It checked a one-hour slice on Wednesday and Sunday before describing the remainder as unverified. The native question labels did not match the staged preview labels, so the browser could not attach the verified option markers. Once the operator said to protect weekdays, Luna verified the four weekend blocks and asked to reconfirm the already supplied target and scope. [Incomplete choices in the widget](../evidence/ask-or-draft-2026-11-22/incomplete-options.png).

In the preference-missing run, the typed answer supplied a real decision the opening left open. In both completed runs, the first reviewed proposal used two hours on Saturday and two on Sunday. The revised plan used two on Saturday and one on Sunday, ending at 11:00. Course coverage changed from 2 h Database and 2 h Algorithms to 2 h Database and 1 h Algorithms. The observed blocks and chat totals agreed. [Initial calendar](../evidence/ask-or-draft-2026-11-22/initial-calendar.png) · [Revised calendar](../evidence/ask-or-draft-2026-11-22/corrected-calendar.png) · [Proposal review](../evidence/ask-or-draft-2026-11-22/corrected-proposal.png).

An independent fixture check used the existing calendar overlap rule. Both authored four-hour distributions were feasible, and the corrected three-hour version was feasible. Wednesday 19:00 can start when the commute ends. Saturday morning is occupied. Neither the unchecked tails of the suggested windows nor Saturday afternoon were ruled out by the first live check.

## Recommended next change

1. **Revise agent guidance first.** Use confirmed facts and dates before asking. If the target and per-day cap determine the allocation, proceed to the existing input review. When two options are feasible and reflect a real preference, compare what the user would preserve or give up. Check the complete proposed options and reuse the exact preview labels. Keep the explicit date range in the review handoff. The current instruction to ask which windows suit the user when the calendar is empty can be clarified to apply when the user has not already given them.
2. **Verify on this pair and a held-out case.** Score whether every option respects hard limits, whether the answer changes the reviewed windows, whether the prose agrees with the schedule, and whether the operator must repeat supplied facts. Count fields as well as widgets. Include a held-out case where asking is appropriate because capacity or source authority is genuinely unresolved. Keep deterministic approval, revision and provider checks independent.
3. **Add structured option validation only if needed.** Today the preview checks stated intervals for calendar conflicts. If confusing or impossible options persist, a small contract could carry option IDs and proposed blocks so dates, hours and breaks can be validated before the widget renders. This has a wider tool and UI cost than refining guidance. A dedicated preference widget or a planner change needs separate evidence. The longer-horizon balance experiment remains under #42.

The report covers interaction and one-week allocations for one fictional fixture using prepared answers. It provides no human UX finding, provider comparison, or assessment of the full planning horizon.
