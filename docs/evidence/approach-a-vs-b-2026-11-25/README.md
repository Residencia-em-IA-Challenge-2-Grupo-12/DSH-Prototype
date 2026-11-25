# Approach A1 & A2 vs. Approach B Live Comparison (2026-11-25)

- **Harness:** Real Docker Calendarpit (`ghcr.io/iktakahiro/calendarpit:0.9.7`) + local SQLite budgeted OpenRouter gateway (`$0.25`/run cap) + independent Python probe
- **Total observed OpenRouter spend (this A1+A2 matrix):** `$0.1236` USD across 16 run(s)
- **Approach B baseline source:** `docs/evidence/live-single-agent-baseline-2026-11-24/summary.json` (`scripts/compare-live-models.mjs`, `success` scenario)

## Head-to-Head Comparison (`success` Scenario: A1 vs. A2 vs. B)

| Approach | Model | Case | Overall | Probe | Duration | LLM Calls | Validation Retries | Questions (Turns) | Input / Output Tokens | Observed USD | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1** | `meta/muse-ember` | `ana-held-out` | **PASS** | PASS | 60.0s | 13 | 0 | 2 (1) | 14,278 / 22,607 | $0.0123 | All checks passed; retirement verified |
| **A2** | `meta/muse-ember` | `ana-held-out` | **PASS** | PASS | 26.8s | 4 | 1 | 2 (1) | 9,695 / 10,563 | $0.0058 | All checks passed; retirement verified |
| **B** (single-agent) | `meta/muse-ember` | `ana-held-out` | **PASS** | PASS | 47.3s | 15 | 1 | 4 (1) | 244,170 / 9,635 | $0.0082 | Baseline (15 tool calls, 1 tool errs) |
| **A1** | `meta/muse-ember` | `bruno` | **PASS** | PASS | 64.8s | 13 | 0 | 2 (1) | 15,511 / 25,056 | $0.0133 | All checks passed; retirement verified |
| **A2** | `meta/muse-ember` | `bruno` | **PASS** | PASS | 37.3s | 3 | 0 | 2 (1) | 7,744 / 15,774 | $0.0084 | All checks passed; retirement verified |
| **B** (single-agent) | `meta/muse-ember` | `bruno` | **PASS** | PASS | 44.6s | 14 | 0 | 4 (1) | 266,943 / 10,026 | $0.0090 | Baseline (14 tool calls, 0 tool errs) |
| **A1** | `openai/gpt-6-luna` | `ana-held-out` | **PASS** | PASS | 114.9s | 15 | 1 | 2 (1) | 17,764 / 13,239 | $0.0085 | All checks passed; retirement verified |
| **A2** | `openai/gpt-6-luna` | `ana-held-out` | **PASS** | PASS | 27.8s | 3 | 0 | 2 (1) | 6,880 / 3,355 | $0.0023 | All checks passed; retirement verified |
| **B** (single-agent) | `openai/gpt-6-luna` | `ana-held-out` | **PASS** | PASS | 56.5s | 16 | 1 | 3 (1) | 198,663 / 5,299 | $0.0069 | Baseline (16 tool calls, 1 tool errs) |
| **A1** | `openai/gpt-6-luna` | `bruno` | **PASS** | PASS | 90.4s | 15 | 1 | 2 (1) | 20,312 / 10,715 | $0.0073 | All checks passed; retirement verified |
| **A2** | `openai/gpt-6-luna` | `bruno` | **PASS** | PASS | 22.2s | 3 | 0 | 2 (1) | 7,664 / 2,760 | $0.0021 | All checks passed; retirement verified |
| **B** (single-agent) | `openai/gpt-6-luna` | `bruno` | **PASS** | PASS | 51.2s | 16 | 0 | 4 (1) | 229,160 / 3,886 | $0.0068 | Baseline (15 tool calls, 0 tool errs) |

## Full Matrix (`success` & `stale` Safety Scenarios for A1 & A2)

| Pipeline | Model | Case | Scenario | Overall | Probe | Duration | LLM Calls | Retries | Tools | Input / Output Tokens | Observed USD | Failure / Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `a1` | `openai/gpt-6-luna` | `bruno` | `success` | **PASS** | PASS | 90.4s | 15 | 1 | 22 (0 err) | 20,312 / 10,715 | $0.0073 | Passed; retirement verified |
| `a1` | `openai/gpt-6-luna` | `bruno` | `stale` | **PASS** | PASS | 99.3s | 15 | 1 | 22 (0 err) | 19,750 / 11,512 | $0.0077 | Passed; retirement verified |
| `a1` | `openai/gpt-6-luna` | `ana-held-out` | `success` | **PASS** | PASS | 114.9s | 15 | 1 | 22 (0 err) | 17,764 / 13,239 | $0.0085 | Passed; retirement verified |
| `a1` | `openai/gpt-6-luna` | `ana-held-out` | `stale` | **FAIL** | PASS | 72.6s | 8 | 1 | 9 (0 err) | 2,534 / 2,294 | $0.0060 | execution: The replay run did not complete. Inspect the private runtime and local diagnostic.; External runner 400 on POST /sessions/a1-ebd207773537/answer: {"detail":"A1 Validation stopped (no_progress) with unresolved errors: Verbatim quote was not found in 'lms/assessment-export.json'. Candidate lines: ['\"exportedAt\": \"2026-10-31T10:10:00Z\",', '\"updatedAt\": \"2026-10-30T18:00:00Z\",', '\"opensAt\": \"2026-11-23T11:00:00Z\",', '\"dueAt\": \"2026 |
| `a1` | `meta/muse-ember` | `bruno` | `success` | **PASS** | PASS | 64.8s | 13 | 0 | 22 (0 err) | 15,511 / 25,056 | $0.0133 | Passed; retirement verified |
| `a1` | `meta/muse-ember` | `bruno` | `stale` | **PASS** | PASS | 72.7s | 15 | 1 | 22 (0 err) | 20,822 / 29,412 | $0.0157 | Passed; retirement verified |
| `a1` | `meta/muse-ember` | `ana-held-out` | `success` | **PASS** | PASS | 60.0s | 13 | 0 | 22 (0 err) | 14,278 / 22,607 | $0.0123 | Passed; retirement verified |
| `a1` | `meta/muse-ember` | `ana-held-out` | `stale` | **PASS** | PASS | 96.0s | 15 | 1 | 22 (0 err) | 19,098 / 37,276 | $0.0198 | Passed; retirement verified |
| `a2` | `openai/gpt-6-luna` | `bruno` | `success` | **PASS** | PASS | 22.2s | 3 | 0 | 27 (0 err) | 7,664 / 2,760 | $0.0021 | Passed; retirement verified |
| `a2` | `openai/gpt-6-luna` | `bruno` | `stale` | **PASS** | PASS | 22.0s | 3 | 0 | 27 (0 err) | 7,647 / 2,756 | $0.0021 | Passed; retirement verified |
| `a2` | `openai/gpt-6-luna` | `ana-held-out` | `success` | **PASS** | PASS | 27.8s | 3 | 0 | 27 (0 err) | 6,880 / 3,355 | $0.0023 | Passed; retirement verified |
| `a2` | `openai/gpt-6-luna` | `ana-held-out` | `stale` | **PASS** | PASS | 26.1s | 3 | 0 | 27 (0 err) | 6,747 / 2,798 | $0.0020 | Passed; retirement verified |
| `a2` | `meta/muse-ember` | `bruno` | `success` | **PASS** | PASS | 37.3s | 3 | 0 | 36 (0 err) | 7,744 / 15,774 | $0.0084 | Passed; retirement verified |
| `a2` | `meta/muse-ember` | `bruno` | `stale` | **PASS** | PASS | 20.3s | 3 | 0 | 36 (0 err) | 7,737 / 8,858 | $0.0050 | Passed; retirement verified |
| `a2` | `meta/muse-ember` | `ana-held-out` | `success` | **PASS** | PASS | 26.8s | 4 | 1 | 27 (0 err) | 9,695 / 10,563 | $0.0058 | Passed; retirement verified |
| `a2` | `meta/muse-ember` | `ana-held-out` | `stale` | **PASS** | PASS | 24.2s | 4 | 1 | 27 (0 err) | 9,857 / 9,779 | $0.0053 | Passed; retirement verified |

## Aggregate Findings

- **Approach A1 (5-stage StudyBuddy roles, `success`):** 4/4 PASS, avg 82.5s/run, avg 14.0 LLM calls, avg $0.0104/run
- **Approach A2 (typed state-machine + code verifier, `success`):** 4/4 PASS, avg 28.5s/run, avg 3.3 LLM calls, avg $0.0046/run
- **Approach A1 (all `success` + `stale` runs):** 7/8 PASS, avg 83.8s/run, avg 13.6 LLM calls, avg $0.0113/run
- **Approach A2 (all `success` + `stale` runs):** 8/8 PASS, avg 25.8s/run, avg 3.3 LLM calls, avg $0.0041/run

### Sample `Evento` Rastro (`A1`, `openai/gpt-6-luna`, `bruno`)

```text
[Maestro] triagem → initial_plan: objetivo=Planejar os estudos para a prova escrita de Algoritmos e o projeto final de Banco de Dados.; nota=Ainda não há contexto confirmado; reunir e revisar os materiais e o calendário e, se faltarem dados, perguntar sobre prazos, disponibilidade e prioridades antes de propor o plano. (3.18s, llm=1)
[Research] coletou fontes e produziu dossiê: arquivos=3, cursos=6, clarification_needed=True (12.37s, llm=1)
[Communication] gerou síntese final em Markdown: 281 chars (2.47s, llm=1)
[Analysis] propôs rascunho propose_context (iteração 1): O pedido é de contexto inicial e as respostas informam disponibilidade, carga e horizonte. Usei as datas confirmadas dos materiais, aplicando o aviso posterior que transferiu a pro (7.78s, llm=1)
[Validation] auditou proposta (iteração 1) → REPROVADO: bloqueios=2, overload_risk=False; A carga semanal e os limites diários são compatíveis com as janelas informadas, sem risco de sobrecarga aparente. Corrija a alteração recorr (11.02s, llm=1)
[Analysis] propôs rascunho propose_context (iteração 2): O estudante forneceu disponibilidade, meta semanal, limite diário e pausa, então não é necessário pedir esclarecimentos. Mantive as janelas recorrentes declaradas, inclusive quarta (6.44s, llm=1)
[Validation] auditou proposta (iteração 2) → REPROVADO: bloqueios=1, overload_risk=False; As datas dos compromissos acadêmicos estão apoiadas nas citações e a meta de 5 horas semanais não indica sobrecarga por si só. Corrija a dis (9.65s, llm=1)
[Maestro] encerrou loop Analysis↔Validation: stop_reason=max_iterations_reached, iterations=2 (0.00s, llm=0)
[Communication] gerou síntese final em Markdown: 117 chars (1.56s, llm=1)
[Maestro] triagem → draft_plan: objetivo=Gerar uma proposta revisável de estudo para as próximas duas semanas com base nos dados confirmados.; nota=O contexto está confirmado e ainda não existe rascunho; encaminhar para gerar a proposta inicial revisável. (2.67s, llm=1)
[Analysis] executou draft_study_plan com contexto confirmado: weeks=2, avoidDates=[], near=5, future=5 (0.03s, llm=0)
[Communication] gerou síntese final em Markdown: 202 chars (2.75s, llm=1)
[Maestro] triagem → revise_plan: objetivo=Deixar livres as segundas-feiras, 2 e 9 de novembro.; nota=Já existe um rascunho; ajustar o plano para liberar as duas segundas-feiras e preservar as demais condições. (2.48s, llm=1)
[Research] coletou fontes e produziu dossiê: arquivos=3, cursos=7, clarification_needed=True (17.85s, llm=1)
[Analysis] propôs rascunho draft_avoid_dates_only (iteração 1): As segundas-feiras, 2 e 9 de novembro, ficam sem blocos de estudo; as demais janelas, a carga e os prazos permanecem inalterados. (1.83s, llm=1)
[Validation] auditou proposta (iteração 1) → APROVADO: bloqueios=0, overload_risk=False; O rascunho deixa livres as segundas-feiras corretas, 2 e 9 de novembro de 2026, e não altera as demais janelas, a carga ou os prazos. (4.37s, llm=1)
[Maestro] encerrou loop Analysis↔Validation: stop_reason=approved, iterations=1 (0.00s, llm=0)
[Analysis] executou draft_study_plan com contexto confirmado: weeks=2, avoidDates=['2026-11-02', '2026-11-09'], near=5, future=5 (0.03s, llm=0)
[Communication] gerou síntese final em Markdown: 109 chars (1.79s, llm=1)
```

### Sample `Evento` Rastro (`A2`, `openai/gpt-6-luna`, `bruno`)

```text
[Stage1.Ingestion] coletou arquivos e calendário via toolBridge: arquivos=3, eventos=146 (0.03s, llm=0)
[Stage2.Extraction] extraiu prazos e preferências faltantes: deadlines=6, conflicts=1 (9.92s, llm=1)
[Stage3.Gate] avaliou citações e lacunas de preferências: perguntas=2, alertas_citacao=0 (0.00s, llm=0)
[Stage4.SynthesisVerifier] validou em código e submeteu propose_planning_context: courses=2, through=2026-11-15, retries=0 (7.55s, llm=1)
[Stage1.Ingestion] coletou arquivos e calendário via toolBridge: arquivos=3, eventos=146 (0.02s, llm=0)
[Stage4.PlannerBridge] gerou proposta revisável via draft_study_plan (0 LLM): weeks=2, near=5, future=5 (0.02s, llm=0)
[Stage1.Ingestion] coletou arquivos e calendário via toolBridge: arquivos=3, eventos=146 (0.03s, llm=0)
[Stage4.Revision] aplicou revisão avoidDates diretamente em draft_study_plan: avoidDates=['2026-11-02', '2026-11-09'], near=5, future=5 (2.64s, llm=1)
```
