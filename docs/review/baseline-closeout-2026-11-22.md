# Experimental baseline closeout · 22 November 2026

PR #8 was merged after the baseline decision. PR #57 subsequently added the clarified question policy and its browser evidence. The verified baseline is cb86720882b9dcbe6c6f60243ae2e4379a2a6d33. Its tree matches the reviewed #57 head. The local source checkout was clean and reused the pinned Node dependency installation. GitHub also passed the integrated offline, scripted-browser and Calendarpit workflows from its own checkouts.

## Verification

- 189 offline checks and the bilingual package build passed at the baseline. The package has 16 slides, a 25-minute suggested briefing, locally verified links and matching ZIP round-trip hashes.
- Scripted Chrome passed conflict, context/source review, stale approval, and near-only application cases. Prior live GPT-6 Luna evidence applies to the identical #57 tree. The host subscription route is an experimental fallback with Calendarpit in Docker. [Live clarification retests](clarification-guidance-2026-11-22.md).
- Five fresh provider replays passed and retired. The later edit survived stale review, duplicate approval made one set of changes, and lost responses remained unacknowledged even when a subsequent observation found an accepted event. An unavailable read carried no event count. The Python probe checked the five DSH results.
- A scoped polling smoke used 60 provider reads spaced two seconds apart on one pinned Calendarpit instance. Docker memory samples rose from 24.99 to 108.7 MiB against the 512 MiB cap in 119 seconds. The resource retired. This is an ordinary short-session observation. The growth and longer-session failure remain tracked under #11.
- The portable Ana input packed and passed the Python format smoke. It remains a mock on the second-engine side. StudyBuddy's main was 030f41c and its #11 and #21 contract/confirmation issues were open. The next #47 step is to agree on the runner boundary and implement one real StudyBuddy adapter. [Portable DSH contract](../paired-replay.md).

[Machine-readable baseline checks](../evidence/baseline-closeout-2026-11-22/baseline-verification.json).

## Original demo acceptance

| Issue | Verified for the delivered demo | Residual work and destination |
| --- | --- | --- |
| #1 demo, #9 readiness, #41 integration review | Integrated synthetic demo, closeout evidence and approved PR #8 integration. | Adoption and foundation selection track separately in #10–15. |
| #2 harness and calendar | Pinned provider integration, OAuth, reset and reads/writes. Community plugin fit documented. | Real provider validation requires a separate readiness decision. Broader lifecycle contract stays in #11. |
| #3 synthetic bilingual scenarios | The two personas, bounded source selection, PDF/text, four- and six-week coverage and reset are verified by the regression suite. Bruno and Ana have live evidence. | Human parity and consistent reply language stay in #44. Additional personas inform #45 and #46. |
| #4 planning and checkpoints | Revision and near/future approval, reduced-hours, new-conflict and changed-deadline checks, and replays for stale and uncertain writes passed. | A live reduced-hours walkthrough and richer adaptation stay in #14. Restart and provider-limit residuals stay in #11. |
| #5 feedback and reports | Legacy optional feedback and deterministic metrics keep scheduled, reported and missing data distinct. | #5 stays open under #14 for managed feedback, bilingual labels and end-to-end report parity. Evidence-informed reporting also belongs to #14. |
| #6 evaluation | Offline, scripted browser, provider replay, live route evidence and dated failures remain inspectable. | Human UX observations stay in #44. Matched model runs and later retrieval evaluation stay in #15. |
| #7 setup and docs | Working Docker simulator and documented host fallback, portable bilingual onboarding package and contribution procedure. | Full Docker-only live route and broader worker policy stay in #12. |
| #36 bounded write recovery | Safe stop, truthful unknown and verified retirement. Earlier integration tests cover interrupted ownership and archive failures. | Maintenance-assisted restart with unknown writers and bounded provider races remain under #11 and #12. In-place reconciliation remains a separately scoped decision. |
| #40 walkthrough and package | Actual Luna walkthrough, the approved annotated screenshot replay, bilingual facilitator guide and scorecard. | Group session remains unscheduled. Human scoring is unobserved. Live language consistency and matched interface evaluation stay in #44. |

## Older drafts and proposed Git operations

The [retention manifest](../evidence/baseline-closeout-2026-11-22/retained-drafts.json) records the branch, head, base, and 142 changed paths across 16 drafts. Each path records its source and baseline blob. None is byte-identical on the baseline. This is an exact provenance check. Separate semantic and test review is needed for each proposed replacement.

| Review unit | Preserve and consolidate |
| --- | --- |
| #10–12 domain and runtime | #17 and #24 have revision history and HTTP tests. Compare against the current service before selecting a small shared contract. #27 adds observer and approved-create paths on top of old replay work. Preserve these tests separately from the full write-recovery path. #29 is evidence for domain-only container packaging. |
| #44 interface | #22 registration and gateway tests, #31 read-only descriptors, #34 native mount and cleanup, #30 shared consumer and #33 custom shell belong in one reproducible comparison. Retain the original carrier refs until both mount on the selected contract. |
| #42/#45 planner | First consolidation candidate is #19 into the later #35 experiment review. Solver core and original solver tests are byte-identical. #35 expands CI discovery and adds sensitivity results. #19 retains its distinct Markdown explanation and original workflow history. #25 supplies separately reusable fixture generation and bilingual source assets. |
| #46 retrieval and #14 guidance | #20/#26 form one retrieval unit with runner, corpora and exploratory results. #32 dossiers have a distinct review and admission decision. |
| #12/#48 worker isolation | #28 provides bounded process and probe evidence. Keep those tests as input to the separate worker policy review. |

First review a successor for #19/#35 and retain the distinct explanation and both workflow histories, then propose exact closure of the redundant draft. Review the other families when their experiment is active. A branch closure requires a verified destination and a reviewed content disposition. The source refs remain available. The student fixture, locale coverage and CP-SAT claim should be reviewed independently of branch count.

## First planner comparison prep

Six named cases are frozen, with pinned calendar hashes, a 15-minute grid, hard constraints, known attainable minutes and a separate Ravi holdout. The reference runner measures the actual application heuristic plus the existing opt-in course-coverage variant. All observed variants met the case capacity bounds and passed independent validation. The readiness suite distinguishes an allowed shortfall from a violation of the weekly maximum. [Runnable cases, budget and comparison rubric](../../experiments/planner-readiness/README.md).

- Equal-cutoff Bruno scheduled 30 hours. The 19/11 course split reversed when input order changed. The existing coverage option left this imbalance intact.
- Ana’s four-hour total remained achievable. The default was 4/0 and the existing coverage option 3/1. Explicit Bruno priority, date exclusions, deadline boundaries, all-day caregiving and shift exceptions passed.
- The next run compares a corrected heuristic with a compatible CP-SAT adapter. The older solver spikes used a 30-minute grid and invented indivisible tasks. Choose the objective order and pin the CP-SAT runtime before tuning. Preserve separate findings on legality, allocation, useful alternatives and explanation.

[Machine-readable reference results](../evidence/baseline-closeout-2026-11-22/planner-baseline.json).

## Experiment entry points

Start the planner comparison after its brief is agreed. The native/custom comparison needs one frozen proposal/approval contract and two mounted carriers. The embedding screen can run on a frozen bilingual corpus under its resource cap. #47 needs a StudyBuddy-side adapter owner and shared contract agreement. #48 follows scripted paired replay and worker route, catalog, filesystem, cancellation and aggregate-budget verification. The #10–12 adoption dependencies remain attached to #13.
