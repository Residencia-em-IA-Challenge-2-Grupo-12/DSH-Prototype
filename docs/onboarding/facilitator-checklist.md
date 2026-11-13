# Facilitator checklist / Checklist do facilitador

**Draft · 13 November 2026.** Compact instructions for one local facilitator using fictional data. Browser startup with Luna and continuous recording remain unverified. A bounded host-side Luna API attempt has completed; it is not the group browser walkthrough. This document is not a claim that the group live session is ready. See [current status](../managed-companion-progress.md).

## English

### Before the session

- [ ] Copy the [scorecard](scorecard.md), read the [Bruno persona](bruno-persona.md), and record the exact commit, run/attempt, harness/model and runtime. Keep the 20–30-minute briefing/example separate from hands-on exploration.
- [ ] Identify the evidence honestly: live Luna, an actual recording, screenshot replay or scripted infrastructure. Show remaining limitations and prepared answers/cuts. The old visual reports are background, not a current onboarding deck.
- [ ] **Live startup remains pending verification.** Use only the subsequently verified launch instructions for the chosen route; do not improvise by changing provider, bypassing tool policy or exposing controls remotely. Luna is the baseline model. No live-provider fallback is implied by this checklist.
- [ ] For the already tested **scripted integration only**, from the repository root with Docker and the prebuilt `study-dsh-agent:synthetic` image: run `node scripts/preview-managed-synthetic.mjs`, then open `http://127.0.0.1:4176/` on the facilitator machine. Start Bruno. This helper uses a fixed fake upstream, not Luna, and accepts only the sequence below. It is unsuitable for free exploration or assessing model quality. A fresh launcher is required for another attempt.
- [ ] Verify the intended runtime and run ID, clean synthetic Bruno fixture, fixed date 2 November 2026 and São Paulo timezone. Preserve prior-run evidence; replacement must wait for verified retirement. Do not use a legacy reset endpoint or manually clear claims/state to force a new run.
- [ ] Check that the calendar is observable, current tool-policy validation passed for the actual route/image, and no unresolved write blocks the run. For recording, exclude credential/login screens and unrelated windows. If continuous recording is unavailable, use the agreed explicitly labeled screenshot replay; a scripted replay is not live Luna evidence.

### Guided exercise

- [ ] Send the persona's initial planning request. Observe whether the agent reads relevant context and asks a useful missing question. Answer from the persona; mark unknown facts unknown. Log new group decisions. Do not reward merely repeating facts such as the five-hour target.
- [ ] Review the initial proposal before any approval: sources, assumptions, first-week load, work/classes/travel, breaks, deadlines and future outlook. A conflict-free schedule can still be implausible. For the scripted helper, answer its fixed question with five hours and continue; score live question quality N/O.
- [ ] Send: **“Keep Monday, 2 November 2026 free.”** Confirm the revision adds no study that day and preserves existing events. Compare changes and explanations; record failures instead of silently editing the evidence.
- [ ] Review near and future sections independently. If the near-term proposal is acceptable, approve **only Coming week** using its explicit review control. Discussion/answers are not approval. Expected result: near-term changes applied and observed, future section pending with no future proposal events created. Inspect actual calendar state, not the assistant's assertion alone.
- [ ] Fill the five scorecard criteria with evidence and N/O where needed. In a verified live route, continue with group-paced free exploration. Do not attempt free chat beyond the fake gateway's fixed sequence. Keep technical failures separate from collaboration judgments.

### End or recover

- [ ] Save the scorecard and available synthetic evidence. End/archive the selected run and confirm retirement before replacement or changing persona. For the scripted launcher, SIGINT/SIGTERM initiates archival/retirement and prints its retained evidence directory; inspect success rather than assuming the signal erased the run.
- [ ] If Send is disabled, inspect startup/busy/pending-question/blocked status and the visible error. Answer the pending question through its form. If the connection fails, record the failure and leave unobserved agent behaviors N/O; deterministic review exercises may continue only where supported and clearly labeled.
- [ ] If writes are interrupted, partial, unavailable or unknown, **do not retry approval or reset blindly**. Preserve run IDs, decisions and observations. Cancellation does not undo an external write. Keep replacement blocked until old writers/resources are verified retired by the trusted procedure. In-place reconciliation and a complete recovery procedure remain pending; escalate to the project maintainer rather than deleting state/socket/containers manually.
- [ ] Report what was actually observed, incomplete and unknown. This synthetic session authorizes no real calendar/workspace access, PR merge or foundation selection.

## Português brasileiro

### Antes da sessão

- [ ] Copiar a [ficha de avaliação](scorecard.md), ler a [persona Bruno](bruno-persona.md) e registrar commit, execução/tentativa, harness/modelo e ambiente. Separar os 20–30 minutos de apresentação/exemplo da exploração prática.
- [ ] Identificar a evidência: Luna ao vivo, gravação real, capturas em sequência ou integração roteirizada. Mostrar limitações e respostas/cortes preparados. Os relatórios visuais antigos são contexto, não a apresentação atualizada.
- [ ] **A inicialização do fluxo ao vivo ainda precisa ser verificada.** Usar somente as instruções posteriormente verificadas da rota escolhida. Não trocar modelo/provedor, contornar políticas ou expor controles remotamente para fazer funcionar. Luna é o modelo padrão; este checklist não autoriza fallback de provedor.
- [ ] Para a **integração roteirizada já testada**, na raiz do repositório, com Docker e imagem `study-dsh-agent:synthetic` já construída: executar `node scripts/preview-managed-synthetic.mjs` e abrir `http://127.0.0.1:4176/` na máquina do facilitador. Iniciar Bruno. O gateway usa respostas fixas, não Luna, e aceita apenas a sequência abaixo. Não serve para exploração livre ou avaliar qualidade do modelo. Nova tentativa exige novo processo inicializador.
- [ ] Conferir ambiente/ID, cenário Bruno limpo, data fixa 2/11/2026 e fuso de São Paulo. Preservar evidências anteriores; nova execução exige encerramento verificado. Não usar reset legado nem apagar reivindicações/estado para forçar outra execução.
- [ ] Conferir calendário disponível, validação das ferramentas na rota/imagem efetiva e ausência de escrita não resolvida. Excluir telas de credenciais/login e janelas alheias da gravação. Se não houver gravação contínua, usar capturas anotadas explicitamente identificadas; sequência roteirizada não é evidência de Luna ao vivo.

### Exercício guiado

- [ ] Enviar o pedido inicial da persona. Observar leitura de contexto e pergunta relevante. Responder com os fatos escritos; manter desconhecidos como desconhecidos e registrar decisões novas. Não premiar repetição da meta de cinco horas, já disponível.
- [ ] Revisar fontes, suposições, carga da primeira semana, trabalho/aulas/deslocamento, intervalos, prazos e futuro antes de aprovar. Ausência de conflitos não garante plausibilidade. No helper roteirizado, responder cinco horas à pergunta fixa; avaliar qualidade de pergunta ao vivo como N/O.
- [ ] Enviar: **“Mantenha segunda-feira, 2 de novembro de 2026, livre.”** Conferir que a revisão não adiciona estudo nesse dia e preserva compromissos. Comparar alterações e explicações; registrar falhas sem editar silenciosamente a evidência.
- [ ] Revisar próximo e futuro separadamente. Se aceitável, aprovar **somente Próxima semana** pelo controle explícito. Conversa/respostas não são aprovação. Esperado: eventos próximos aplicados e observados; futuro pendente, sem os eventos futuros propostos criados. Conferir o calendário real do simulador, não só a afirmação do assistente.
- [ ] Preencher os cinco critérios com evidências e N/O quando necessário. Em rota ao vivo verificada, seguir para exploração livre no ritmo do grupo. Não ultrapassar a sequência fixa do gateway falso. Separar falhas técnicas de julgamentos sobre colaboração.

### Encerrar ou recuperar

- [ ] Salvar ficha e evidências disponíveis. Encerrar/arquivar e verificar retirada dos recursos antes de substituir execução ou persona. No helper roteirizado, SIGINT/SIGTERM inicia arquivamento/encerramento e informa o diretório preservado; conferir sucesso, sem supor que o sinal apagou a execução.
- [ ] Se Enviar estiver desabilitado, conferir início/atividade/pergunta pendente/bloqueio e erro visível. Responder perguntas pelo formulário próprio. Se a conexão falhar, registrar e marcar comportamentos não observados como N/O; usar exercícios determinísticos somente onde suportados e identificados.
- [ ] Se uma escrita for interrompida, parcial, indisponível ou desconhecida, **não repetir aprovação/reset às cegas**. Preservar IDs, decisões e observações. Cancelar não desfaz escrita externa. Bloquear substituição até verificar encerramento dos escritores/recursos pelo procedimento confiável. Reconciliação no lugar e recuperação completa seguem pendentes; chamar a manutenção em vez de apagar estado/socket/containers manualmente.
- [ ] Relatar observado, incompleto e desconhecido. A sessão sintética não autoriza calendário/arquivos reais, merge ou seleção de fundamentos.
