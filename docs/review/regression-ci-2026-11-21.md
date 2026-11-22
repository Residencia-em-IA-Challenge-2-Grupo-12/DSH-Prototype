# Integration review and Ana regression · 21 November 2026

The review pinned [main](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/commit/03edd68ad4e54d4cad33653ea1886085b514216a), [PR #52](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/52) at `e398126`, and [PR #53](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/53) at `4df26bd`. [PR #54](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/54) is stacked on #53. All Git integrations in this review took place in an isolated local checkout. The combined candidate uses #52’s opt-in Ana coverage alternative and the scripted browser’s near-only approval exercise.

## Standards review

- **Reproducible evidence.** The original #53 result stamped a bare `HEAD` value even when source, scripts or fixtures were dirty. The follow-up labels those runs as worktree evidence.
- **Malformed intervals.** The independent schedule checker accepted a bad end timestamp because the comparisons evaluated to false. The checker now rejects invalid and nonpositive intervals before the scripted approval. A regression test also catches an unreviewed window, too little break time, and excess daily and weekly load.
- **Localization upkeep.** #52’s two course coverage labels sit inside the renderer. They have English and Portuguese variants. Moving them to the existing message catalog is a small maintainability follow-up.

## Spec review

- **Reviewed feasibility.** #53 originally checked dates, deadlines, and overlaps. The new preflight checks the confirmed availability and horizon, weekly target for the fixed complete Bruno case, daily cap, breaks, section assignment and preservation of existing events before sending approval.
- **Historical versus new schedules.** The earlier runner required a new proposal to contradict archived narration. The narration unit test uses pinned blocks. A new Bruno proposal may choose different times that meet the same agreed constraints.
- **Portable verification.** The Python probe now checks a successful validation before approval, ignores approval once a negative decision is recorded, and rejects a duplicate applied outcome. The independent provider observation still establishes what happened externally. #52’s coverage alternative remains an optional planner argument. The request requirement is agent guidance.

## Test schedule

The existing offline checks continue to cover all PR updates. The new workflows run a Bruno smoke with disposable Calendarpit and test the browser with an in-memory fixture, each on relevant changes. A manual replay option runs the four extra stale, duplicate and unknown-write scenarios. The synthetic build and integration jobs require no model credentials. Live model and human review track usefulness separately. [Run frequency and local commands](../regression-testing.md).

## Ana and the operator workflow

The selected case stages only the three workspace files. The offline regression checks the original and superseding deadline, the UTC/local deadline match, a one-date correction, both weekly targets, stale approval of the prior revision, and the remaining future Wednesday after its appointment. Existing cases and runtime routing use the same entry points.

- **Attempt 1:** The model found and converted the published deadline correctly. It included a context-only clinic in the scheduler's target list. The operator automation missed the pending input-review state and timed out. No approval or write occurred. The fixture retired. The tool schema now says that every included target can receive study blocks and cap the horizon.
- **Attempt 2:** Luna used the memo alone, revised the plan to keep 4 November free, and all four approved coming-week events applied. The provider observation retained 108 original records and the future section stayed pending. Luna initially omitted the 11 November block in its explanation and later called it a conflict. The real 14:00–15:00 appointment ends exactly at the tentative 15:00–16:00 block. The proposal details now show exact intervals in chronological order, and browser-session instructions tell Luna to use the actual draft and check exact intervals before claiming a conflict.
- **Attempt 3:** With the exact-interval guidance and review changes, the first and revised descriptions both matched their proposals by day and total. Luna still described the larger 11 November window as busy during questioning, then correctly distinguished the narrower block in its draft explanation. The coming week applied four events, with 108 originals preserved and all future changes pending. Operator elapsed time was 88 seconds. The instance retired.

The questions and explanations were observed in agent-operated Chrome with prepared fictional answers. The initial availability and scope were asked more than once in the first two runs. In the last run Luna recorded the preference scope through 16 November, although the two requested weeks ended on 15 November. The two-week planner call kept that extra date out of the proposal. These observations point to question burden and scope display as useful follow-ups for human review. The coverage, scheduling and write checks are separate from a claim of useful questioning.

The portable sample preserves the decisions, two proposals and the independent validation of the revised schedule. It adds an optional question group ID so a native widget and its individual fields can be counted separately. The combined checkout at `935d7aa` passed 186 offline checks, the onboarding build, five Calendarpit cases, and scripted Chrome for both personas. [All three attempts and the timing checks](../evidence/ana-regression-2026-11-21/summary.json) · [Portable result](../evidence/ana-regression-2026-11-21/ana-live-result.json) · [Browser proposal](../evidence/ana-regression-2026-11-21/proposal.png).

## Suggested integration order

Review #52 on its own, then fold the #54 follow-up into #53 before deciding on #53 into main. This keeps the replay safeguard and test wiring with the replay they depend on. The combined review found one browser fixture conflict and preserved both behaviors locally. Revalidate that resolution after any approved integration. The parallel-implementation and provider-sandbox choices remain separate decisions.
