# Demonstration review brief

**Later evidence, 16 November:** see [the bounded readiness review](review/readiness-2026-11-16.md) for the local Luna browser attempt, UI correction and current limits. The dated observations below remain historical.

Updated 13 November 2026. Scripted browser evidence is pinned at `934b0fb`; newer Luna API attempts retain source hashes in the linked review extract. GitHub PR inventory was refreshed before the later implementation commits. Read time: about five minutes for the English brief; Portuguese summary at the end. This document requests no merge or architecture selection.

## What needs your decision now?

**No additional approval is needed to continue the agreed demonstration work.** The immediate gaps are implementation and verification tasks, not unanswered product questions. The existing authorization covers the synthetic live walkthrough, recording investigation and bilingual onboarding materials. The actual subscription-loaded tool/profile audit now passes, and two current-route Luna API attempts completed. Subscription sign-in would need your action only if the existing login stops working; no such request is pending.

You can review [the PR preservation and consolidation proposal](pr-consolidation-proposal.md) now. It is a map for discussion, not a list of branches ready to merge. Do not use the older PR #8 readiness review as today's approval request: it records defects at an older pinned head and needs a new integrated readiness report.

## What has actually been demonstrated?

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Current scripted Bruno browser run | The companion reaches DSH and its focused tools; context reads, a human question, proposal, Monday correction and near-term approval work through the real integration. Five near-term events were observed; future events remained absent and pending. | Luna's judgment, question quality or schedule personalization. The upstream responses were authored. |
| 150 passing offline tests | Regression coverage for state, approval, recovery and other modeled behavior on this branch. | A complete live workflow or all deployment/restart conditions. |
| English and Portuguese screenshots | Actual final review screens, translated controls and proposal statuses. | A recording, a bilingual conversation or the planned proportional week view. |
| Current live Luna API attempts | Two real subscription runs completed context, question, proposal, Monday correction and near-only simulator approval. The host-clock issue found in attempt 1 was corrected before attempt 2. | Human browser readiness, recording, final deployment or a model-quality comparison. |
| Historical live Luna SDK exercise | The earlier subscription route completed a synthetic collaborative sequence. | Readiness of today's brokered, restricted-tools route or Docker topology. |

See the [schedule and collaboration review](onboarding/luna-schedule-review.md) for the two current Luna API attempts and their limitations. The latest browser run used a host controller and web server, with the agent and simulator in Docker. Its pinned agent image predates the newest SDK timer/tool-policy changes. That limitation is recorded rather than treated as a verified deployment.

Evidence: [current browser report](managed-companion-progress.md), [independent state assertions](evidence/managed-browser/scripted-bruno-result.json), [English capture](evidence/managed-browser/scripted-bruno-en.jpg), [Portuguese capture](evidence/managed-browser/scripted-bruno-pt.jpg), [Luna route findings](luna-fallback-probe.md).

## Presentation and walkthrough status

The existing `calendar-assistant-briefing/index.html` and `index.pt-BR.html` are dated visual reports from 8–9 November. They remain historical background, not the finished onboarding presentation. They omit the latest recovery/runtime/browser work and contain older model/evaluation assumptions.

| Agreed deliverable | Current state | Next action |
| --- | --- | --- |
| Current Luna-led Bruno walkthrough | API sequence verified twice on the labeled host fallback; browser walkthrough pending | Connect and exercise the actual route in the browser; retain failures and runtime disclosures. |
| Representative real recording with captions | Not available | Verify continuous capture; retain the approved, explicitly labeled screenshot-replay alternative if genuine recording is unavailable. Current screenshots show scripted integration only. |
| Switchable English/Portuguese presentation | Not built | Generate both languages from shared content, with verified date, implemented/planned labels, current evidence and one simple PR overview. |
| Facilitator checklist, Bruno persona sheet and reusable scorecard | Bilingual drafts now available in [onboarding](onboarding/) | Verify live browser startup/recovery instructions and incorporate walkthrough findings. |
| Portable offline folder/ZIP | Not assembled | Package presentation, media, captions and local documents; verify links and offline use. |
| Group-operated exercise | Not yet held | After the briefing, run the guided Bruno correction/near-only approval flow, then free exploration at the group's pace. |

The planned session remains a 20–30-minute briefing and recorded example, followed by a separately timed hands-on session. The five scorecard criteria remain useful questions, context and assumptions, schedule feasibility, response to correction and separate-approval clarity, with “not observed” and evidence notes.

## Explicit review checkpoints

| Decision | What you should receive first | Recommendation today |
| --- | --- | --- |
| Review whether the walkthrough is suitable for the group session | Representative live evidence, failures, runtime disclosure, checklist and scorecard | Wait for that evidence; a successful scripted run is insufficient. |
| Merge PR #8 | Refreshed readiness report, fixed head/base, tests and exact resulting integrated diff | Keep draft. Do not treat #37/#38/#39 changes as already part of #8. |
| Integrate, retarget or close dependent PRs | Exact Git operations, new effective diffs and unique-work preservation map | Discuss the grouping now; execute only after the concrete sequence is reviewed. |
| Adopt a persistent host-controller exception | Measured Docker limitation and actual authority/isolation tradeoffs | No new exception is proposed here. A temporary topology test is not deployment approval. |
| Select interface/planner/embedding; activate guidance; use real data | Their agreed comparison/admission/readiness evidence | Retain the separate later decisions. |

Current backbone: `main ← #8 ← #37 ← #38 ← #39` (each arrow points from the child to its current PR base). There are **24 open draft PRs**. GitHub reported successful checks for all four backbone heads at inspection; this is not a review or merge recommendation.

## What I would grill you on

Use the first live review to decide whether the observed compromises are acceptable for the group exercise. For each of the five criteria: what did you actually see, what would make you reject it, and what remained unobserved? Ask specifically whether the revised week is plausible alongside Bruno's work/classes, whether the explanation makes the tradeoff understandable, and whether near-term approval clearly leaves future changes pending.

For Git review: decide whether the proposed review units are understandable and whether every superseded experiment's unique tests/results have a retained destination. Green CI alone cannot answer either question. We do not need another broad product-planning round before finishing the already agreed demonstration.

## Português — decisões e situação atual

**Você não precisa autorizar novamente o trabalho já combinado.** A validação com o plugin real passou e duas tentativas com Luna concluíram o fluxo pela API. Ainda faltam conexão/verificação no navegador, investigação da gravação e conclusão dos materiais bilíngues.

O navegador já percorreu o fluxo com respostas roteirizadas: contexto → pergunta → proposta → correção para liberar segunda-feira → aprovação apenas da próxima semana. Cinco eventos foram confirmados no simulador; nenhum evento futuro foi criado. Isso comprova a integração, não a qualidade do Luna. Os 150 testes offline mais recentes passaram. O controlador/servidor estavam no host; agente e simulador estavam em Docker, com as limitações de versão registradas.

A apresentação existente ainda é um relatório visual antigo em dois arquivos. A versão final com troca de idioma, a gravação/capturas anotadas e o pacote portátil ainda não foram concluídos. O checklist, a ficha do Bruno e a avaliação agora existem como rascunhos bilíngues. A sessão continua planejada como 20–30 minutos de apresentação e exemplo, com exploração prática separada.

Leia primeiro este resumo e, se quiser discutir Git, o [mapa de consolidação](pr-consolidation-proposal.md). Não recomendo merge agora. Antes da sua decisão sobre o #8, precisamos apresentar prontidão atualizada e o diff integrado exato. O fluxo com Luna deve fornecer evidências para você julgar plausibilidade, colaboração e clareza da aprovação; as escolhas de interface, planejador, embeddings e acesso a dados reais continuam em marcos separados.
