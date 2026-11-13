# Draft PR inventory — 2026-11-12

Snapshot before implementation; branch heads and check results may change. This inventory does not authorize merging, retargeting or closure.

| PR | Head | Base | Checks at snapshot |
| --- | --- | --- | --- |
| [#8](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/8) | `feat/study-planning-demo` `6bce31c1ab13` | `main` | SUCCESS |
| [#16](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/16) | `feat/calendar-checkpoint-replay` `6b909a561d4c` | `feat/study-planning-demo` | SUCCESS |
| [#17](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/17) | `feat/domain-store-spike` `c26724052172` | `feat/study-planning-demo` | SUCCESS |
| [#18](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/18) | `feat/calendarpit-run-lifecycle` `f4e641d35cb0` | `feat/study-planning-demo` | SUCCESS |
| [#19](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/19) | `feat/solver-comparison-spike` `6df7a5faef61` | `feat/study-planning-demo` | SUCCESS |
| [#20](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/20) | `feat/embedding-screen-smoke` `bea47e8cc63c` | `feat/study-planning-demo` | SUCCESS |
| [#21](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/21) | `feat/calendarpit-provider-api` `8c2e808f0212` | `feat/calendarpit-run-lifecycle` | SUCCESS |
| [#22](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/22) | `feat/dsh-sidebar-spike` `516b3157a11b` | `feat/study-planning-demo` | SUCCESS |
| [#23](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/23) | `feat/calendar-experiment-bundle` `6f2e128f08de` | `feat/calendarpit-provider-api` | SUCCESS |
| [#24](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/24) | `feat/domain-service-api` `ae9cc62964e2` | `feat/domain-store-spike` | SUCCESS |
| [#25](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/25) | `feat/realistic-bilingual-personas` `8e792920c09c` | `feat/study-planning-demo` | SUCCESS |
| [#26](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/26) | `feat/bilingual-retrieval-challenge` `da6fdc7f1fe9` | `feat/embedding-screen-smoke` | SUCCESS |
| [#27](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/27) | `feat/calendar-domain-bridge` `095f5693ca7d` | `feat/calendar-experiment-bundle` | SUCCESS |
| [#28](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/28) | `feat/synthetic-worker-spike` `f8aeea2a2ccf` | `feat/study-planning-demo` | SUCCESS |
| [#29](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/29) | `feat/domain-service-container` `2a3cf7e9ef8e` | `feat/domain-service-api` | SUCCESS |
| [#30](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/30) | `feat/shared-consumer-spike` `bbd28fa9609d` | `feat/calendar-domain-bridge` | SUCCESS |
| [#31](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/31) | `feat/dsh-domain-read-bridge` `df54567bbcc9` | `feat/domain-service-api` | SUCCESS |
| [#32](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/32) | `feat/evidence-admission-dossiers` `874907ba02cc` | `feat/study-planning-demo` | SUCCESS |
| [#33](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/33) | `feat/custom-shell-comparison` `bc321a40173f` | `feat/shared-consumer-spike` | SUCCESS |
| [#34](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/34) | `feat/dsh-native-panel` `ad8c02010682` | `feat/domain-service-api` | SUCCESS |
| [#35](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/35) | `feat/fixture-solver-comparison` `b506d165cd88` | `feat/realistic-bilingual-personas` | SUCCESS |
| [#37](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/37) | `fix/baseline-recovery` `bad383e8721b` | `feat/study-planning-demo` | SUCCESS |
| [#38](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/38) | `feat/disposable-study-runs` `216fa5ea387d` | `fix/baseline-recovery` | FAILURE, SUCCESS |

The #38 failure at head `216fa5ea387d` was the interrupted-writer test reading a readiness file before its JSON write completed. The failure was reproduced with an injected delay; an atomic marker publication passed the same reproduction and 130 offline tests locally. The snapshot predates that fix; check the new head CI before readiness.

The earlier reconciliation review remains a preliminary guide: compare unique behavior, tests and artifacts before proposing any branch closure. PR #8 requires a separate explicit merge decision.
