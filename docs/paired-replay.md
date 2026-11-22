# Portable study-planning replay

This v1 draft carries one synthetic study-planning exercise between implementations. The DSH adapter runs Bruno with authored turns through the managed study API, the existing planner, and a fresh Calendarpit. Ana provides a held-out source variation that can be packed and checked and opened through the separate Luna browser workflow. [Scope and handoff decisions](review/paired-replay-handoff-2026-11-21.md) · [Regression test schedule](regression-testing.md).

## Run Bruno

From the repository root with the pinned Node dependencies installed and Docker available, use a new output directory. The commands create one synthetic account and simulator per run. They make no model calls. Python 3 is only required for the optional cross-language probe.

```sh
run_dir=$(mktemp -d /tmp/study-replay-XXXXXX)
./node_modules/.bin/node scripts/paired-replay.mjs pack bruno "$run_dir/bruno"
./node_modules/.bin/node scripts/paired-replay.mjs run "$run_dir/bruno" "$run_dir/success.json"
python3 scripts/paired-replay-probe.py --check-result "$run_dir/bruno" "$run_dir/success.json"
```

Repeat `run` with a new output file and an optional fourth argument after the command name and paths:

| Scenario | Operator and simulator behavior |
|---|---|
| `success` | Answer the availability question, revise to keep both Mondays free, and approve the coming week only. |
| `stale` | Update a fictional commitment after review and attempt the same approval. The edit must survive without a study write. |
| `duplicate` | Send the same approval twice. Exactly one set of changes may be written. |
| `unknown` | Calendarpit accepts the first write, then the adapter loses its response. The observer can see its effect; the claim remains unresolved. |
| `unknown-unavailable` | Lose the response and inject a read failure. The result reports unavailable observation separately from the unresolved write. |

A failure case exits zero when its safety checks passed. Inspect `timeline` for decision, write, and observation outcomes. `retirement` tells you whether the run’s labeled Docker resources were verified absent. On a failed check, failed recording, or unresolved claim, the CLI prints the private synthetic runtime directory for inspection. Keep that evidence, and follow the existing [recovery guidance](host-luna-preview.md#simulator-unavailable--simulador-indisponível) for a blocked retirement. The saved output protects against overwriting an existing report. Use the [browser guide](cold-start-browser-review.md) for the separate live Luna exercise.

## Contract and ownership

The bundle contains `case.json`, `calendar.json`, `workspace/`, and JSON Schemas for the manifest and result. SHA-256 pins the exact calendar and source bytes. It detects drift. Trust comes from a reviewed bundle and code revision. The calendar payload contains fixture users, calendars and events. Each runtime supplies fresh synthetic authorization. Proposal revision, run and event IDs are scoped to the run. Compare exact observed IDs within a run, and equivalent meanings and constraints across implementations.

The **operator** owns the request, prepared answers, revision request, approval decision, and expected evidence. `case.json` includes those private expectations. A real adapter should disclose only the opening request, the selected workspace and calendar tool, and each prepared answer when the runner chooses to send it. The current authored DSH driver uses the canonical Bruno planning inputs and verifies the staged source bytes before any tool call. The Python probe tests interoperability with a mock interaction. It marks calendar execution as unobserved.

A result separates proposal, validation for that revision, decision, write acknowledgment and independent observation. An available observation may contain zero changes. An unavailable one carries no count or delta. An event observed after a lost response can coexist with an unresolved claim. A check is tagged `pass`, `fail`, or `not_observed`. Questions may include `groupId` to preserve which fields appeared together in one native widget. Independent case validation compares the cited source and deadline, and checks dates, deadlines and overlaps in the small synthetic scenario. Reviewed windows use exact endpoints, including seconds. The scripted operator withholds approval if these checks fail. The Python probe rejects applied receipts for superseded revisions or invalidated approvals. This checks the reported sequence of events. Independent provider observation establishes the resulting calendar state. The schedule-claim checker takes reviewer-annotated day or week totals. It does not extract claims from prose.

`pack ana-held-out` uses the same manifest and result contract. Its authoritative deadline is in a structured LMS export alongside superseded and optional material. Use the Python mock to check its packaging. For the browser evaluation use `STUDY_COLD_CASE=ana-held-out` with the [local Luna launcher](cold-start-browser-review.md#live-luna). Only the fixture’s workspace files are staged for the agent. [Held-out operator notes](../fixtures/paired-replay/ana-held-out/README.md).

## Português

O exercício usa o caso fictício de Bruno, respostas roteirizadas e uma instância descartável do Calendarpit por execução. Rode os comandos acima na raiz do repositório. `pack` prepara os documentos, o calendário, o manifesto e os esquemas JSON. `run` registra as perguntas, a revisão, a aprovação separada e o resultado da leitura independente. O teste com Python verifica a interoperabilidade do formato. Use o [guia do navegador](cold-start-browser-review.md) para a avaliação com Luna.

O manifesto inclui o gabarito e as respostas do operador. Entregue ao assistente apenas o pedido e o contexto permitido, e envie as respostas preparadas quando necessárias. O caso alternativo de Ana inclui uma data atualizada em um arquivo JSON do LMS. A simulação executável deste adaptador cobre Bruno. O resultado distingue uma leitura indisponível de uma leitura bem-sucedida sem alterações. Uma gravação com resposta perdida pode continuar incerta mesmo se a leitura encontrar o evento.
