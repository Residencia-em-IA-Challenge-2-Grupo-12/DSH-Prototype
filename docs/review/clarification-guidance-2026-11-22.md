# Asking only when the answer changes the plan · 22 November 2026

We replaced conflicting cold-start instructions with one rule. Submit resolved inputs for review. Ask about a material choice or an unresolved source conflict. The browser prompt also asks for complete options verified against the calendar, exact labels for attaching those previews, and the confirmed date range when handing off to the planner. Input confirmation remains a separate step before the draft.

Source tested: prompt and SDK regression at 7ec1b4630943cf54b4932910570fafb296103de4 on the evidence branch. The host Luna fallback used the same signed-in GPT-6 Luna route and DSH 0.2.2-rc.1, a fresh Calendarpit instance per attempt, and prepared fictional replies in headless Chrome. Usage was unavailable. [Baseline cases and first attempts](ask-or-draft-2026-11-22.md).

## Results

| Case | Prior evidence | With revised guidance |
| --- | --- | --- |
| Bruno, complete inputs and correction | Two widgets, three fields in the dated repeat. The questions repeated facts. | Zero questions. The initial and shortened-Sunday inputs went directly to review. |
| Bruno, open workday/weekend tradeoff and correction | Two widgets. Four slots were requested and two checked slots were shown. | One widget with two complete four-block options. The typed answer selected the all-weekend schedule. The correction went directly to review. |
| Ana, unresolved source authority | Held-out case. | One question about the LMS noon cutoff and guide 18:00 cutoff. Confirmed noon, then drafted the intended dates without another question. |

In the tradeoff widget, Luna checked one Wednesday block plus three weekend blocks as one option, and four weekend blocks as the other. Both used the actual windows. Both fit the four-hour target, two sessions per day, 15-minute break and protected Monday. The preview labels matched the question labels, so the browser could display the checks. The operator chose to protect Wednesday. [Live tradeoff widget](../evidence/clarification-guidance-2026-11-22/bruno-tradeoff.png).

Both Bruno proposals moved from two Saturday and two Sunday blocks to two Saturday and one Sunday block. The final Sunday session ended at 11:00. The dated Bruno requests used the same wording as the baseline comparison. [Revised week view](../evidence/clarification-guidance-2026-11-22/bruno-corrected-calendar.png).

Ana's module guide says the project closes at 18:00 on 30 November. The LMS tile says noon and gives no version or supersession evidence. Luna asked which to use before submitting the reviewed inputs. The operator provided the fictional instructor's resolution. The record cited the LMS passage and preserved the explanation. “Draft the coming week using the confirmed inputs” then yielded four blocks on 4 and 6 November, within the confirmed 2–8 November scope. [Live deadline widget](../evidence/clarification-guidance-2026-11-22/ana-deadline-question.png).

## Verification and follow-up

- Independent checks verified the exact proposal times, source deadlines, question-window matches, hard constraints and calendar conflicts. The provider returned the same full event records throughout each exercise, 146 for each Bruno run and 108 for Ana. No calendar approval control was used. All three named containers and networks were verified absent after archival.
- The 189-check offline suite passed, including a regression that checks the new guidance is sent on the first browser turn and a later correction. The separate scripted browser suite passed its conflict, stale approval, near-only write and source-opening cases. Live attempts took 81, 113 and 53 seconds end to end. [Run records and exact options](../evidence/clarification-guidance-2026-11-22/summary.json).
- The tested guidance produced feasible choices in this small sample. A separate widget guard would need structured option constraints, such as target, daily limit and break, to check more than overlaps. Revisit that change if further cases reproduce impossible options. Keep calendar approval and final validation in the trusted review path.
- The operator used English. Luna asked both substantive questions in Portuguese. The evidence measures the decision flow, with language consistency still open. Ana's proposal allocated four hours to the earlier Machine Learning deadline and zero to Statistics. Course coverage and explaining tradeoffs remain part of #42. Human effort and broader model behavior are unmeasured.
