# Schedule review decisions

Recorded 13 November 2026 from the user's review of the [two real Luna API attempts](luna-schedule-review.md). These are product-review expectations, not a solver selection, PR merge approval or evidence that the current implementation satisfies them.

## Agreed

1. When deadlines match and mastery/remaining work are unknown, “balanced” means **roughly equal study time across the planning horizon**, allowing weekly variation. Context or an explicit user choice may justify another split. Do not present an arbitrary unequal allocation as personalized evidence.
2. If the answer could materially improve a proposal, ask **one consequential workday/weekend tradeoff question** rather than treating all stated windows as equally desirable. The question should lead to a supported planning decision, not merely collect a preference the system cannot use.
3. Balance is a **soft default**, with explained departures for known workload, urgency, availability or explicit priorities. Equal time is a fallback when needs are unknown, not an estimate that both courses need the same work or a claim about learning effectiveness.
4. A load preference applies **provisionally to the current planning horizon**. Recheck at a checkpoint or when circumstances materially change; do not silently turn it into a permanent preference or ask the same question on every turn.

## Longer-term direction, still exploratory

The user wants future control over study activities and methods, subject/task compatibility, retention goals, stated preferences, place/resources and optional tiredness context. The next step should expose assumptions and test small changes before fixing a detailed specification. A course's allocated hours, the activity performed, its method and the time/place of execution are related decisions, not interchangeable measures of quality.

Keep the current balance/load improvements distinct from that later exploration. The [research notes](../research/study-method-experiment-notes.md) distinguish task-specific evidence from proposals; recording a source does not admit it into active guidance. No study-method engine or new planner has been selected.

## Consequences for the observed runs

- Both runs initially allocated 19h to Algoritmos and 11h to Banco de Dados across six weeks, then 18h/12h after the Monday correction. No known mastery or remaining-work difference justified that split. The heuristic's output does not establish that the agreed balance expectation is met.
- The agent asked about course priority and confirmed existing windows, but did not ask about lighter workday evenings versus protecting weekend time. The proposed Wednesday 2h / Saturday 2h / Sunday 1h therefore remains a compromise to discuss, not a demonstrated preference match.
- Current planner inputs include `hours`, `weeks`, `avoidDates`, `preferredPeriod` and `focusCourse`. They do not include a workday/weekend load preference or an explicit horizon balance objective. `avoidDates` excludes dates; it must not silently turn a soft load preference into an absolute ban. `preferredPeriod` means time of day, not workday/weekend priority.

## Scope findings

The course-allocation decision is concentrated in `makePlan` in `src/core.mjs`, so a bounded heuristic correction can be investigated independently of a solver choice. A meaningful load preference also needs an explicit input and tool contract, agent handling and validation; changing only the chat instructions would be insufficient. No planner code or prompt policy was changed by recording these decisions.

## Next exploration questions

- Whether the first study-method experiment should use only course blocks, a few authored activities, or agent-derived activities. This is a prototype-scope question, not a production contract.
- How to handle unknown energy, place and resources without turning missing data into asserted facts or an obligatory questionnaire.
- Identify a bounded balance/load experiment and decide which remaining quality limitations must be fixed before the representative group recording. Existing authorization to connect the browser, investigate recording and finish the package remains in place.

## Português

Ficou combinado que, com prazos equivalentes e sem dados sobre domínio/esforço restante, “equilibrado” significa **tempo aproximadamente igual no horizonte**, com variação entre semanas. Também deve haver **uma pergunta relevante sobre a troca entre noites de trabalho e fim de semana**, quando a resposta puder mudar a proposta.

As tentativas atuais ainda não demonstram essas expectativas: a distribuição foi 19h/11h, depois 18h/12h, sem uma necessidade conhecida que justificasse a diferença; a pergunta sobre a concentração da carga não ocorreu. A heurística atual não tem parâmetro explícito para esse tipo de preferência. Excluir datas não equivale a preferir uma carga mais leve.

O equilíbrio agora está definido como padrão flexível, não obrigação absoluta. A preferência de carga vale provisoriamente no horizonte atual, com revisão quando necessário. O usuário quer explorar futuramente atividades/métodos, objetivos de retenção, preferências, lugar/recursos e cansaço informado opcionalmente, em passos pequenos que possam produzir feedback antes de fixar a especificação. Ainda estamos definindo o primeiro experimento e o tratamento de informações ausentes. Isso não escolhe um solver, não aprova merge e não altera silenciosamente a arquitetura. O trabalho já autorizado de navegador, gravação e pacote pode continuar de forma independente.
