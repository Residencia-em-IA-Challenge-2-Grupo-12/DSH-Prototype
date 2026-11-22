# DSH portable replay handoff · 21 November 2026

The DSH slice of #47 packages a workspace and calendar, runs the scripted Bruno loop, and records a comparable result. It targets `main` at `03edd68ad4e54d4cad33653ea1886085b514216a`. Draft #52 at `e398126` had two green hosted checks and remains a separate browser-reliability review. The replay uses confirmed inputs from the pinned baseline, so it does not depend on the opt-in coverage alternative or its MCP schema changes. [DSH replay #47](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/47) · [Draft #52](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/52).

## Chosen implementation

| Decision | Reason and alternative |
|---|---|
| Pack a manifest, selected bytes and a credential-free calendar payload. | Existing Calendarpit checkpoint replay already tests recurrence and fresh authorization. It covers calendar state. The portable case adds source hashes, a fixed clock, and an operator script. Restoring the whole agent process would add runtime-specific state and reuse stale approvals. |
| Reuse the managed study API in a headless script. | The runner drives the existing question, context review, planner, claim and approval paths through a scripted client. Browser automation would add UI dependencies to the format test. A new planner or approval implementation would weaken the connection to the DSH app. The CLI starts its own disposable simulator and calls the trusted service in process. It does not exercise the browser controller or DSH SDK. |
| Keep reviewed proposals, write results, and a separate provider observation. | A generic failure event loses whether a write was prevented, sent without acknowledgment, or independently observed. The contract distinguishes those cases. The existing private recovery state remains available on failure or uncertainty. |
| Export JSON Schemas and use an independent Python probe. | This exercises the wire format across languages with no shared runtime dependency. The probe checks identifiers, references and hashes and emits a clearly labeled mock. StudyBuddy can implement its own adapter after those maintainers review the contract. |
| Check timing claims independently of the planner. | Reviewer-annotated claims let us test Bruno’s four-hour estimate and supposedly unused Wednesday against the proposed blocks. This is a small #42 check. Changing the allocation policy or having a second model grade prose would add different questions. |

## Reuse audit for the next StudyBuddy conversation

- **DSH runtime.** `calendar-experiment.mjs` and the provider client can be exercised without loading the harness. `managed-study-api.mjs` and `trusted-study-service.mjs` already expose the workflow seam. The browser, SDK subscription route and worker permissions remain separate. `initializeScenario` stages a known persona workspace and checks its original calendar. The Bruno adapter verifies exact source bytes and seeds its simulator from the packed calendar. Arbitrary persona or provider inputs need a separate adapter decision. [Calendar replay guide](../calendar-replay.md).
- **Held-out fixture.** Reused the draft persona work’s fixed clock and realistic commitments, and the retrieval challenge’s superseded-source and unknown-fact patterns. Authored a small Ana variation with a Markdown draft, a clinic notice and the authoritative JSON release record, with no preferences file. The all-persona draft contains unsupported runtime IDs and the old relevance results used a corpus that was inspected and corrected. The new case checks source-form variation on Ana. It does not establish generalization to an unseen persona. [Persona draft #25](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/25) · [Retrieval draft #26](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/pull/26).
- **StudyBuddy.** Preserve the fixed advice workflow and the 28-question corpus, raw results, prompts, settings and scoring at `030f41c`. Reuse the retrieval implementation if it can return verifiable excerpts and stable source IDs. Its present citation checker validates source names. DSH checks the quote occurs in the cited text/page, which also leaves the structured due date to be checked. First compare which tool finds the authoritative dated record, rejects a superseded one, and surfaces unknowns. Then decide whether bringing over any tools beats adapting outputs. [StudyBuddy methodology](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/studybuddy/blob/030f41caec37bc57c353b64b8dbde3ab8f417983/pesquisa/relatorio/final/01-metodologia.md) · [Preserved results](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/studybuddy/tree/030f41caec37bc57c353b64b8dbde3ab8f417983/pesquisa/metricas/relatorios).

## Verified results

The baseline checkpoint integration passed stored recurrence, independent authorization and retirement. The portable cases ran on `eb4d451152d467e9bd400c38f96b897868501674` with Node `24.11.1` and the existing pinned Calendarpit. All five ran in fresh simulators and passed retirement verification, 180 offline checks passed, and the bilingual onboarding package rebuilt. The standard-library Python probe read all five DSH results. JavaScript validated the two Python outputs as scripted mocks with calendar outcomes unobserved. [Run identities, measurements and hashes](../evidence/paired-replay-2026-11-21/summary.json).

| Replay | Independent result |
|---|---|
| Near only | Five additions with matching proposal IDs and times. All 146 existing events unchanged. Future pending. |
| Stale approval | The concurrent synthetic edit was preserved, with zero study writes. |
| Duplicate approval | The first request applied once. The repeated request made no further write. |
| Lost response | One event was visible. The unacknowledged write stayed unresolved with no retry. |
| Lost response and unavailable read | The unresolved write stayed unknown. The observation carried no event count or delta. |

[Full Bruno result](../evidence/paired-replay-2026-11-21/success.json) · [Full unavailable result](../evidence/paired-replay-2026-11-21/unknown-unavailable.json).

The #42 timing check caught both recorded discrepancies: week two contains 300 minutes versus the previously claimed 240, and 11 November contains 60 minutes versus the earlier claim of zero. The check uses reviewer-labeled claims against allocations. Model behavior was outside this scripted run.

The short #11 smoke check used two fresh Bruno simulators under the existing 512 MiB cap. After five samples over 42 seconds, the idle container stayed around 18–19 MiB. The other rose from 31 to 58 MiB across 15 calendar-list requests. Both retired. This is enough to motivate a longer repeat with recorded polling cadence and memory samples. The hour-scale failure and its cause remain unresolved. [Calendarpit issue #11](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/11).

## Review checkpoint

Run and inspect the [portable replay](../paired-replay.md). Check specifically that an unavailable read stays distinguishable from an observed empty delta, the superseded exam date is excluded, and a replayed approval targets only the selected revision and section. Work on the StudyBuddy adapter can start after agreement on this format. A paired DSH–StudyBuddy run, a live Ana run, a matched model comparison, and runtime delegation remain unobserved. Once there are two real adapters, review which fields need to be promoted from this draft. Longer-session Calendarpit memory behavior remains a separate #11 investigation.
