# Reviewable study plans · 21 November 2026

The next slice makes planning inputs, calendar availability and one schedule alternative easier to inspect. The operator still confirms the input revision and separately decides whether to apply each proposal section.

| Finding | Implemented decision | Alternative considered |
| --- | --- | --- |
| Luna previously sent a two-week total of ten hours as the weekly target. | The cold-start draft tool accepts the horizon. The planner reads hours per week from the confirmed revision. The trusted planner still rejects a conflicting override. | A prompt reminder would leave two competing sources of truth. Keeping the legacy hours input in the legacy catalog preserves existing callers. |
| Luna previously counted adjacent activities as a conflict before showing a question. | The option tool returns observed overlaps to Luna before it asks. The planner and widget use half-open intervals. The trusted selection check reads the calendar again. | Calendar prose alone requires the model to compute overlaps and makes it hard to explain why choices differ. Permitting an intentional concurrent event is a separate experiment with its own approval. |
| Ana’s default gives all four hours to the earlier assessment. | A requested course coverage alternative gives each eligible course a first block where feasible, then follows the existing allocation. It uses the same reviewed inputs and creates a new reviewable proposal. | Changing the default or introducing a solver would make a wider change. The comparison holds the capacity, dates and policy constant and changes one allocation choice. |
| A relative segment in an absolute profile path caused a synthetic run to fail at startup. | The launcher resolves and checks the profile directory before opening the controller. The existing credential profile stays in its configured location. | Operator-only normalization recovered the attempt, with a diagnostic still needed for invalid paths. |

## What the tests showed

**Bruno, live Luna in Chrome.** The operator specified the proposed availability fork and supplied prepared fictional answers. Luna read the files and calendar, found the exam notice that superseded the old date, and used the question widget to identify that 18:45–19:45 overlaps the commute while 19:00–20:00 is clear. A correction removed both Mondays. After review, the tool requested two weeks and used the confirmed five hours in each. Approval added the five intended near-term events, preserved all 146 original event records, and left five future additions pending. The post-start trace through the approved write took 125.6 seconds including the operator interactions. Usage is unknown. Both attempts were archived and their containers and networks were verified retired. The first attempt failed before any model calls because of the profile path. The second used the authorized host Luna fallback with disposable Calendarpit.

**Remaining explanation issue.** Before drafting, Luna estimated four hours for week two from a Wednesday family commitment. The actual plan fit five by placing a block at 20:00 after that commitment. The operator used the structured schedule for review. A final assistant summary was outside the captured trace. The prior and current observations support testing date-by-date agreement between explanations and the resulting proposal. [Schedule quality #42](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/42).

**Ana, scripted Chrome and deterministic planner.** The case checks the conflicting noon and 18:00 sources, opening the selected citation in the review panel. With identical four time slots, the default allocates Machine Learning 4 h and Statistics 0 h. The coverage alternative reallocates one hour to Statistics. A stale approval of the superseded revision is rejected and the simulator is unchanged. This comparison establishes that both drafts are feasible under the same stated constraints. The value of moving the hour depends on Ana’s priorities, preparation and workload.

| Ana · coming week | Existing heuristic | Coverage alternative |
| --- | ---: | ---: |
| Machine Learning | 4 h | 3 h |
| Statistics | 0 h | 1 h |
| Available slots used | 4 | 4 |

Screenshots and machine-readable evidence are linked here. The browser operator used prepared answers. Human ratings and live Ana behavior remain unobserved. [Bruno availability](../evidence/reviewed-planning-2026-11-21/bruno-availability.png), [Ana default](../evidence/reviewed-planning-2026-11-21/ana-default.png), [Ana alternative](../evidence/reviewed-planning-2026-11-21/ana-alternative.png), [run and observations](../evidence/reviewed-planning-2026-11-21/summary.json).

## Integrated base and remaining choices

#49 landed on `main` before the four calendar drafts were closed with preservation references. #51 landed in #50, then #50 landed at `03edd68`. Both merge trees matched the previously verified code. Main CI passed offline checks and the bilingual package build. Local verification covered 180 offline checks, scripted Chrome for both personas, disposable Calendarpit recurrence replay, and the launcher preflight with both a canonicalizable and missing profile. [Main CI](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/actions/runs/44871566191), [consolidation #41](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/41).

Review the date-by-date explanation and the allocation tradeoff before changing scheduling defaults. Group review can use the existing package whenever participants are available. The next independent engineering step is a versioned StudyBuddy replay contract and one scripted fixture. Isolated delegation follows the replay and worker boundary tests. [StudyBuddy viability review](../research/studybuddy-foundation-2026-11-21.md).
