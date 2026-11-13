# Schedule review decisions

Recorded 13 November 2026 from the user's review of the [two real Luna API attempts](luna-schedule-review.md). These are product-review expectations, not a solver selection, PR merge approval or evidence that the current implementation satisfies them.

## Agreed

1. When deadlines match and mastery/remaining work are unknown, “balanced” means **roughly equal study time across the planning horizon**, allowing weekly variation. Context or an explicit user choice may justify another split. Do not present an arbitrary unequal allocation as personalized evidence.
2. If the answer could materially improve a proposal, ask **one consequential workday/weekend tradeoff question** rather than treating all stated windows as equally desirable. The question should lead to a supported planning decision, not merely collect a preference the system cannot use.

## Consequences for the observed runs

- Both runs initially allocated 19h to Algoritmos and 11h to Banco de Dados across six weeks, then 18h/12h after the Monday correction. No known mastery or remaining-work difference justified that split. The heuristic's output does not establish that the agreed balance expectation is met.
- The agent asked about course priority and confirmed existing windows, but did not ask about lighter workday evenings versus protecting weekend time. The proposed Wednesday 2h / Saturday 2h / Sunday 1h therefore remains a compromise to discuss, not a demonstrated preference match.
- Current planner inputs include `hours`, `weeks`, `avoidDates`, `preferredPeriod` and `focusCourse`. They do not include a workday/weekend load preference or an explicit horizon balance objective. `avoidDates` excludes dates; it must not silently turn a soft load preference into an absolute ban. `preferredPeriod` means time of day, not workday/weekend priority.

## Scope findings

The course-allocation decision is concentrated in `makePlan` in `src/core.mjs`, so a bounded heuristic correction can be investigated independently of a solver choice. A meaningful load preference also needs an explicit input and tool contract, agent handling and validation; changing only the chat instructions would be insufficient. No planner code or prompt policy was changed by recording these decisions.

## Still being clarified

- Whether balance is a soft default with explained exceptions or a strict requirement until the user changes it.
- Whether a workday/weekend choice applies provisionally to the current horizon, only to the current week, or as a standing preference.
- Once those semantics are settled, identify a bounded implementation and decide which remaining quality limitations must be fixed before the representative group recording. Existing authorization to connect the browser, investigate recording and finish the package remains in place.

## Português

Ficou combinado que, com prazos equivalentes e sem dados sobre domínio/esforço restante, “equilibrado” significa **tempo aproximadamente igual no horizonte**, com variação entre semanas. Também deve haver **uma pergunta relevante sobre a troca entre noites de trabalho e fim de semana**, quando a resposta puder mudar a proposta.

As tentativas atuais ainda não demonstram essas expectativas: a distribuição foi 19h/11h, depois 18h/12h, sem uma necessidade conhecida que justificasse a diferença; a pergunta sobre a concentração da carga não ocorreu. A heurística atual não tem parâmetro explícito para esse tipo de preferência. Excluir datas não equivale a preferir uma carga mais leve.

Ainda estamos definindo a força do objetivo de equilíbrio e a duração da preferência de carga. Isso não escolhe um solver, não aprova merge e não altera silenciosamente a arquitetura. O trabalho já autorizado de navegador, gravação e pacote pode continuar de forma independente.
