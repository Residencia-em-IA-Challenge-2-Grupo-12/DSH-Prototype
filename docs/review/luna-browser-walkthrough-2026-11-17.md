# Bruno browser walkthrough / Walkthrough Bruno

Verified **17 November 2026**. Delivery #40, experimental carrier #39. [Bilingual screenshot replay](../evidence/luna-browser-2026-11-17/replay.html) · [JSON checks/configuration](../evidence/luna-browser-2026-11-17/summary.json) · [Fictional conversation and proposal revisions](../evidence/luna-browser-2026-11-17/conversation-and-plans.json).

## English

**The real Luna browser loop completed through the separately approved near-term write.** Codex operated the existing localhost browser with prepared fictional persona answers. This is an agent-operated UI test, not a human UX review, scripted model response or matched model comparison.

The run used the existing GPT-6 Luna subscription, pinned DSH 0.2.2-rc.1, Bruno's selected workspace and pinned Calendarpit. DSH/controller ran on the host; the simulator ran in Docker. Source during the walkthrough: `734658b648e0f20f8d2793f9d265cb010bcd3077`. The UI follow-up fix is `667dcbb56fc2348fd330646d63897cadc02dc4b1`. Screenshots precede that fix. No paid OpenRouter request occurred; subscription usage and active model execution time remain unknown.

### Observed sequence

1. Started a fresh Bruno run `6b1f6bb9-6fe9-44eb-b257-4ea7d3ca2417`, with 146 observed existing events. Luna read the fictional calendar, preferences and course materials.
2. Luna asked whether existing windows/target remained suitable and which course had priority. We selected **no priority** as an authored exercise decision. The native radio selection survived an English/Portuguese interface switch and reached DSH. The question included a consequential unknown but also reconfirmed already available facts. Multi-select/custom/dismiss modes were not exercised live here.
3. The first proposal had five one-hour near blocks and 25 future blocks. The prepared correction requested no study additions on Monday, 2 November, without moving existing commitments. Luna regenerated the proposal: Wednesday 2h, Saturday 2h, Sunday 1h. Both sections remained pending and the existing calendar remained unchanged before approval.
4. Independent checks found no overlap with existing events or between proposals, no Monday additions, at most two sessions/day and at least 15 minutes between same-day sessions. We clicked **Aprovar próxima semana** in the actual browser. We did not click future approval or treat chat as consent.
5. Independent provider observations found **exactly the five reviewed event IDs added**, all 146 prior event records unchanged, no future event IDs created, near applied/future pending and no unresolved claim. The trusted trace contains one near approval decision and one completed write result.
6. The browser archive click timed out; its dialog API returned no dialog and subsequent DOM access also timed out. The backend still showed an idle active run. Available evidence was preserved, then the trusted local HTTP lifecycle operation archived the observed 151-event calendar and verified writer/resource retirement. Browser archival is **not** counted as passed. No approval was repeated.

### What this demonstrates—and what remains weak

| Criterion | Developer observation, not a formal evaluator/human score |
| --- | --- |
| Useful questions | Consequential course-priority choice; target/windows confirmation partly redundant. No explicit workday-versus-weekend tradeoff question. |
| Context and assumptions | Relevant files/deadlines/commitments were used. However, narration called an uneven plan balanced and referred to five hours on 2 November when only two were allocated there. |
| Feasibility | Five hours fit the authored windows with no conflicts and required breaks. This does not establish that the allocation is optimal, subject-balanced or suitable for a real person's energy. |
| Correction | Monday study additions removed; weekly target retained; existing commitments unchanged. Revised horizon still split 19h Algoritmos / 11h Banco de Dados. |
| Separate approval | Actual near-only UI approval succeeded and future stayed pending. A stale button label and inaccurate location wording weakened clarity. |

The original allocation was **4h/1h in week one and 20h/10h over six weeks** despite the no-priority choice. The revised week became 3h/2h, but the horizon remained 19h/11h. This is further evidence for #42's soft balancing/configuration work, not a new solver selection or an implemented balance fix. The agent's claim of balance must not override deterministic counts.

The applied section's disabled button remained **Applying…** after the write succeeded, because refresh replaced the control while the completion handler still referenced the old node. A screenshot preserved the defect; changing language redrew it. A failing DOM regression reproduced it. Commit `667dcbb` renders the current controls after clearing pending state and corrects the misleading "below the calendar" hint/prompt. **158 offline tests pass.** The post-fix transition was not exercised through another live write.

Luna's response language varied between Portuguese and English; switching the interface did not enforce model language. The success notice retained its previous language. The approved calendar state rendered in both interface languages, but this is not complete localization/accessibility parity.

The observed first-prompt-to-question time was about **20.7s**; first-prompt-to-write was about **197.3s**, including operator actions, answering and polling. These are not active model timing or performance guarantees. Rich private evidence remains separate from the conservative recovery archive. The archive hash, available observation, source/configuration and artifact hashes are in JSON.

### Capture and next steps

The connected browser exposed screenshots but no continuous recording capability. The five-step replay uses actual captures with bilingual annotations and disclosed imperfections; it is explicitly **not video**. It is an interim walkthrough artifact, not the final 20–30-minute onboarding presentation/package. Human review of the agent workflow is still unobserved. The replay rendered in English/Portuguese and its five-step logic/image paths passed a local check. Browser click/keyboard navigation had no observed effect after the archival-control timeout. The facilitator then confirmed on a phone: **“Yes, Next advances”** (1/5 to 2/5). This verifies that limited second-device navigation check; it does not establish all-step inspection, bilingual/accessibility parity or human review of the agent workflow. The earlier automation failure remains a separate tooling observation.

1. Review this replay and the allocation/interaction findings with the facilitator. Run the group-operated session locally and record the five-criterion scorecard; verify the archive control and remaining question modes separately. The basic phone replay-navigation check is now confirmed.
2. Complete the switchable presentation, facilitator checklist verification and portable onboarding package using these real captures. Keep unsupported behavior and host fallback visible.
3. Finish #41/#36's lossless review map and present the exact #39 → #38 → #37 → #8 integration/readiness proposal. PR #8 stays draft until the explicit merge decision; inspect each parent's changed diff after any approved integration. The demo need not wait for every later architecture comparison.
4. Scope the observed balance/narration/load questions in #42 and the simulator memory investigation in #11. The earlier long-run OOM is unresolved; this short success is not a fix. Preserve later interface/planner/embedding selections, bounded model comparison, real-data readiness and remote-control gates.

## Português

**O ciclo real com Luna no navegador chegou à escrita aprovada somente da próxima semana.** O Codex operou a interface com respostas fictícias preparadas. Isso verifica o fluxo pela UI; não substitui teste de UX com pessoas nem comparação entre modelos.

- Luna leu o contexto, perguntou sobre prioridade, recebeu uma seleção pelo widget e gerou uma proposta. A seleção persistiu na troca de idioma.
- Após pedir **segunda-feira, 2 de novembro de 2026, livre**, a revisão manteve cinco horas: duas na quarta, duas no sábado e uma no domingo. As verificações não encontraram conflitos ou violações dos intervalos/limites informados.
- Clicamos separadamente em **Aprovar próxima semana**. A observação independente confirmou exatamente cinco adições, os 146 eventos existentes preservados, nenhum evento futuro criado e nenhuma escrita incerta. O futuro permaneceu pendente.
- O controle de arquivamento no navegador travou. Preservamos as evidências e usamos a operação HTTP confiável para arquivar e verificar a retirada dos recursos. Não contamos esse controle da UI como aprovado e não repetimos a escrita.

**Problemas encontrados:** a primeira proposta foi chamada de equilibrada, mas tinha 4h/1h na semana e 20h/10h no horizonte. A revisão melhorou para 3h/2h na semana e 19h/11h no horizonte, ainda desigual. A explicação também confundiu horas na segunda e apontou os botões no lugar errado. O botão ficou em **Aplicando…** mesmo com o estado aplicado: reproduzimos esse defeito em teste e corrigimos, com **158 testes offline aprovados**. Não fizemos outra escrita ao vivo para testar o patch. Idioma das respostas e avisos ainda não acompanha perfeitamente o seletor.

**O que fazer agora:** revisar o replay, realizar a sessão do grupo com scorecard, conferir o arquivamento e outros modos de pergunta e finalizar a apresentação/pacote. Em paralelo, concluir a revisão sem perda dos PRs e apresentar a decisão de integração/merge. Melhorar equilíbrio e investigar memória são trabalhos delimitados já relacionados a #42/#11; a memória em sessões longas continua sem correção comprovada. O replay contém capturas reais com anotações, **não uma gravação contínua**. Continua sendo o fallback no host, sem comprovar a arquitetura Docker completa, acesso a dados reais ou controle remoto seguro. Nenhum PR foi mesclado e nenhuma base foi selecionada.


**Confirmação no celular — 17 de novembro:** o facilitador informou que **Next avança de 1/5 para 2/5**. Essa verificação de navegação em outro dispositivo está confirmada. Não equivale à revisão completa das cinco etapas, acessibilidade ou avaliação humana do agente. O arquivamento pela interface continua sem verificação.
