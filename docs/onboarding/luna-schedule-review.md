# Luna schedule and collaboration review

Verified 13 November 2026. Two real `codex/gpt-6-luna` subscription attempts, DSH 0.2.2-rc.1. **API exercises with prepared fictional answers and test-driver approval**, not a human browser walkthrough, recording or model comparison. This report contains engineering observations, not blinded evaluator scores or completed human review.

Use this report with the [Bruno persona](bruno-persona.md) and [scorecard](scorecard.md). The [machine-readable review extract](../evidence/luna-bruno-api/review-extract.json) includes questions, actual planner inputs, schedules, explanations, checks and source hashes. Full synthetic conversation/tool evidence and the separate conservative recovery archive are retained privately under the ignored `.runtime/experiments/<attempt-id>/` directories. No subscription credentials were copied there.

## What happened

| | Attempt 1 | Attempt 2 |
| --- | --- | --- |
| Duration, including setup/cleanup | 44.8 seconds | 47.5 seconds |
| Runtime | Host DSH/controller; Docker Calendarpit | Same |
| Meaningful question | Asked how to distribute attention between the courses; also confirmed existing windows/limits | Asked about course priority and confirmation |
| Initial and revised proposals | Generated both | Generated both |
| Calendar before approval | Unchanged | Unchanged |
| Near-only approval | Five events observed | Five events observed |
| Future proposal events written | Zero; approval pending | Zero; approval pending |
| Existing calendar events | Preserved | Preserved |
| Writers/evidence/simulator cleanup | Stopped, archived, retired | Stopped, archived, retired |
| Clock finding | Explanation treated host date as competing with fixed simulation date | Host-clock injection disabled; competing date absent from observed explanations |
| Provider usage | Unknown | Unknown |

The second attempt followed a narrowly tested clock correction: the synthetic profile disables DSH's host time-context injection while retaining real timestamps in evidence. The actual subscription-loaded no-model probe verifies exactly eight agent-visible tools, blocked extra/native tools, broker readiness and no injected host-clock context. All 150 offline tests pass. These checks do not establish complete agent sandboxing or a production deployment.

## The schedule to judge

Bruno works 40 hours per week and has classes on Tuesday/Thursday evenings and Saturday morning. Both courses have deadlines on 14 December. His authored target is five hours per week, at most two one-hour sessions per day with a 15-minute break. Relative mastery, difficulty and remaining work are unknown.

Both attempts used the same deterministic planner inputs: six weeks, five hours, then `avoidDates: [2026-11-02]` for the revision. Neither selected `focusCourse`. Luna interpreted context, asked questions, explained the candidate and requested a supported correction; the algorithm chose the actual placements and course allocations. Identical schedules here are not evidence of deterministic model behavior.

| First week | Initial proposal | After “keep Monday free” |
| --- | --- | --- |
| Monday 2 Nov | Algoritmos 19:00–20:00 and 20:15–21:15 | No new study |
| Wednesday 4 Nov | Algoritmos 19:00–20:00 | Algoritmos 19:00–20:00 and 20:15–21:15 |
| Saturday 7 Nov | Banco de Dados 14:00–15:00 | Banco de Dados 14:00–15:00 and 15:15–16:15 |
| Sunday 8 Nov | Algoritmos 10:00–11:00 | Algoritmos 10:00–11:00 |
| Course allocation | Algoritmos 4h / Banco de Dados 1h | Algoritmos 3h / Banco de Dados 2h |
| Six-week total | Algoritmos 19h / Banco de Dados 11h | Algoritmos 18h / Banco de Dados 12h |

The revised first week has five hours, no conflicts with existing events, no new Monday study and the stated daily/break limits. That establishes feasibility under the supplied rules. It does **not** tell us whether two hours after Wednesday's workday, two after Saturday's classes, and one Sunday hour suit Bruno's energy or priorities.

## Observations worth discussing

- **Questioning:** Course priority was consequential and missing. The five-hour target and candidate windows were already available; confirmation should be judged as confirmation, not discovery. The prepared answer kept missing mastery/workload facts unknown and permitted a provisional allocation.
- **“Balanced” needs a definition:** The first explanation described a balanced/provisional choice while also acknowledging the skew. The observed 19h/11h horizon is not equal allocation. The current heuristic does not offer an explicit numerical balance objective. Do not promise that the model already optimizes one.
- **Correction:** Luna requested the supported date exclusion, preserved commitments and explained that study became more concentrated on Wednesday and Saturday. Whether that compromise is desirable is the useful human judgment.
- **Narrative versus state:** The second initial explanation suggested week 2 would not depend on Wednesday evening, but the planner can use the time after the 19:00–20:00 family event. The corrected explanation asked for a timing check. This is an explanation-accuracy concern even when the stored schedule avoids conflicts.
- **Language:** English requests received a Portuguese initial explanation and an English correction explanation. A selected session language is not consistently enforced on this route yet. Bilingual controls alone do not establish conversational parity.
- **Activity detail:** Topic suggestions in prose are not all persisted as specific tasks in the calendar; event labels remain course-level study blocks. No evidence-informed critique/alternatives or stronger planner selection is established by these runs.

## What remains before the group walkthrough

Connect and verify the approved Luna fallback or managed route in the browser, disclose its actual runtime, and check the presentation's claims against that route. Verify recording support or use the explicitly labeled screenshot-replay alternative. Finish the switchable presentation, captions/replay, portable package and facilitator startup/recovery instructions. Do not present these API runs as the requested recording or as proof of browser readiness.

The next discussion should establish how reviewers interpret course balance and workday/weekend concentration. It need not select a solver or expand this round into the full planning architecture. Keep PR #8's separate readiness and explicit merge gate.

## Português — o que avaliar

As duas tentativas reais com Luna concluíram o fluxo pela API, com respostas fictícias preparadas e aprovação dada pelo teste. A primeira levou 44,8 segundos; a segunda, 47,5. Em ambas, o calendário permaneceu intacto antes da aprovação, cinco eventos próximos foram confirmados depois dela e o futuro continuou pendente. Não houve chamada paga ao OpenRouter; o uso da assinatura não foi informado. Isso ainda não é a exploração humana no navegador nem a gravação pedida.

Após liberar a segunda-feira, a primeira semana ficou: quarta 19:00–20:00 e 20:15–21:15 (Algoritmos), sábado 14:00–15:00 e 15:15–16:15 (Banco de Dados), domingo 10:00–11:00 (Algoritmos). Respeita as regras escritas, mas não sabemos se a concentração após trabalho/aulas é desejável para Bruno.

Há duas decisões úteis para a revisão: o que queremos dizer com distribuição “equilibrada” e quando discutir a troca entre noites de trabalho e tempo no fim de semana. A distribuição inicial foi 4h/1h na semana e 19h/11h no horizonte; após a correção, 3h/2h e 18h/12h. Quem gerou esses números foi a heurística. Luna perguntou, explicou e solicitou a revisão, mas não selecionou um objetivo matemático de equilíbrio.

Também registramos problemas: o relógio real confundiu a primeira explicação (a injeção foi desabilitada e a segunda tentativa não repetiu o aviso), houve alternância de idioma e uma explicação imprecisa sobre a quarta-feira da segunda semana. Os dois resultados foram preservados. A apresentação final, o fluxo no navegador e a gravação continuam pendentes; os materiais de persona, checklist e avaliação já existem como rascunhos bilíngues.
