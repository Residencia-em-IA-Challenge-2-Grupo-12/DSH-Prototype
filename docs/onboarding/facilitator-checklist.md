# Facilitator checklist / Checklist do facilitador

**Verified 17 November 2026.** The real agent-operated Luna browser loop completed through near-only approval. A separate archive-only browser test passed page-level cancellation, Portuguese confirmation and verified retirement. [Live evidence](../review/luna-browser-walkthrough-2026-11-17.md) and [archive checks](../evidence/archive-ui-2026-11-17/summary.json) distinguish those observations. Human workflow assessment is still pending. Use this sequence even if the presenter is unavailable.

## English

### Before the group arrives

- [ ] **Prepare the materials.** Open the bilingual presentation, included actual-screenshot replay, [Bruno persona](bruno-persona.md) and a copy of the [scorecard](scorecard.md). Allow 20–30 minutes for briefing/example. Time the hands-on exercise separately. The package is documentation/evidence, not the application or Docker images.
- [ ] **Use the development computer for controls.** Open `http://127.0.0.1:4176/` directly in its browser. Phone/embedded localhost previews can show a page while API calls fail. Tailscale presentation/replay/calendar previews are read-only. Do not weaken origin checks or expose chat/approval remotely.
- [ ] **Have a maintainer prepare the runtime.** Docker must be running. This authorized live fallback also requires the project's installed Node24 dependencies, Poppler/pdftotext for PDF reads, and an already authenticated DSH subscription profile, outside disposable runs. From the repository root, the maintainer starts:

```bash
STUDY_LUNA_DSH_HOME=/absolute/path/to/existing/dsh-profile \
  ./node_modules/.bin/node scripts/preview-luna-synthetic.mjs
```

- [ ] **Check the expected mode.** The header must say **Host Luna fallback / GPT-6 Luna**. DSH/controller run on the host and Calendarpit in Docker. This is the approved exception, not full Docker isolation. Missing login or provider errors require maintainer inspection; do not copy credentials or silently change provider. The [launch guide](../host-luna-preview.md) covers the private runtime root and restart limits.
- [ ] **Prepare a clean run just before hands-on.** If a run already exists, preserve it and end/archive through its controls; do not clear state, claims, sockets or containers manually. Start Bruno only after retirement is verified. Starting the fixture makes no model call. Expect a unique run ID, fixed 2 November 2026 date, São Paulo times and visible work/classes. Calendar unavailable or a blocked run means stop and preserve evidence.
- [ ] **Disclose the limits.** The real example uses prepared fictional answers and actual screenshots, not continuous video. A 512 MiB simulator was OOM-killed after about 61 minutes in an earlier idle run; the cause/long-session fix remains open. Starting shortly before use is not a reliability guarantee. Stronger balance/load controls, full Docker and production Google access remain unfinished.

### Guided exercise

- [ ] **Ask and answer with the persona.** Send: “Help Bruno plan for his next deadline. Read the selected materials and calendar, explain assumptions, and ask about consequential missing information.” Keep absent facts unknown. Record new group choices. Five hours is already in the context; merely asking it again is not a useful-question success.
- [ ] **Use the question widget.** Choose or type an answer and click **Send answer**, or explicitly dismiss. Neither action approves the calendar. Language switching preserves the question draft; reloading may lose an unsent draft. Current live evidence covers a radio choice; other modes have offline coverage.
- [ ] **Review before approval.** Compare sources and deadlines with the calendar. Inspect first-week times, breaks and total course hours across the horizon. The current heuristic can produce an uneven split despite a no-priority choice, and Luna may describe it too positively. Conflict-free does not establish a personalized or optimal plan.
- [ ] **Make the agreed correction.** Send **“Keep Monday, 2 November 2026 free.”** Expect no new study that day, preservation of work/lunch/travel, a revised proposal and an explanation. For this fixture, the observed revision used Wednesday 2h, Saturday 2h and Sunday 1h; a later model response may differ. Do not silently fix the evidence for it.
- [ ] **Approve near-term only if acceptable.** Use **Approve coming week** in the review controls. Leave **Approve future blocks** untouched. Chat “yes” is not approval. Expect coming week applied, the actual additions visible and future pending. The recorded run added exactly five events and preserved 146 existing events, but verify your own run rather than assuming those counts.
- [ ] **Record five observations.** Rate useful questions, context/assumptions, feasibility, correction and separate approval clarity with 0–2 or N/O. Note evidence and technical failures separately. After the guided task, let the group explore supported changes at its own pace. Do not treat an unsupported parameter as implemented personalization.

### End, failure and recovery

- [ ] **End through the page.** Save your scorecard. Click **End and archive run** and review the student/run ID. **Keep run open** cancels. **Confirm end and archive** starts archival and verified retirement. Expect **No active run** and **Run archived** before starting another. Confirmation is separate from calendar approval and does not create future blocks.
- [ ] **If a request appears to fail, inspect before retrying.** An empty/network response may mean an operation occurred without a usable reply. Refresh and inspect run/section status. The earlier native browser prompt timed out even when backend retirement completed; current page-level confirmation avoids depending on that prompt. Do not repeat an uncertain write or reset blindly.
- [ ] **If Send is disabled, read status.** No run: start one. Busy: wait or use supported cancellation. Pending question: use its form. Blocked/unavailable: preserve IDs and involve the maintainer. If Luna fails, mark agent criteria N/O and use only supported, clearly labeled deterministic exercises. A scripted fake gateway is not Luna or a substitute for assessing conversation quality.
- [ ] **If retirement or ownership is unknown, remain blocked.** Preserve trace/state and ask the maintainer to inspect the trusted lifecycle. Do not change the runtime root to evade a run, remove a claim or restart the in-memory simulator under the same identity. In-place reconciliation and complete automatic restart recovery remain deferred. Cancellation does not undo external writes.
- [ ] **Close with evidence.** Record actual observed/unobserved outcomes and residual concerns. No part of this session authorizes a PR merge, real calendar/workspace access or a foundation selection.

## Português brasileiro

### Antes da chegada do grupo

- [ ] **Preparar os materiais.** Abrir apresentação bilíngue, replay de capturas reais, [persona Bruno](bruno-persona.md) e uma cópia da [ficha](scorecard.md). Reservar 20–30 minutos para apresentação/exemplo e outro tempo para a prática. O pacote contém documentos/evidências, não a aplicação ou imagens Docker.
- [ ] **Usar o computador de desenvolvimento para controlar.** Abrir `http://127.0.0.1:4176/` diretamente no navegador desse computador. Prévias locais no celular podem carregar a página sem permitir API. Links Tailscale de apresentação/replay/calendário são somente leitura. Não afrouxar origem nem expor chat/aprovação.
- [ ] **Pedir a preparação do ambiente à manutenção.** Docker deve estar ativo. O fallback ao vivo também exige Node24/dependências instaladas, Poppler/pdftotext para PDFs e perfil DSH já autenticado, fora das execuções descartáveis. Na raiz do repositório, usar o comando acima com o caminho local do perfil. Não compartilhar esse perfil ou suas credenciais.
- [ ] **Conferir o modo.** Cabeçalho deve identificar **Fallback Luna no host / GPT-6 Luna**. DSH/controlador estão no host e Calendarpit no Docker. É a exceção aprovada, não isolamento Docker completo. Falhas de login/provedor exigem inspeção, sem troca silenciosa. O [guia](../host-luna-preview.md) explica diretório privado e limites de reinício.
- [ ] **Preparar execução limpa pouco antes da prática.** Se já houver uma, preservar e encerrar/arquivar pelos controles. Não apagar estado, reivindicações, sockets ou contêineres. Iniciar Bruno após encerramento verificado. Iniciar o cenário não chama modelo. Esperar ID único, data fixa 2/11/2026, fuso São Paulo e trabalho/aulas visíveis. Calendário indisponível ou execução bloqueada exige parar e preservar evidências.
- [ ] **Explicar os limites.** O exemplo usa respostas fictícias preparadas e capturas reais, não vídeo contínuo. Um simulador com 512 MiB excedeu memória após cerca de 61 minutos. A causa/correção de sessões longas permanece aberta. Iniciar perto do uso não garante estabilidade. Equilíbrio/carga mais ricos, Docker completo e Google de produção seguem pendentes.

### Exercício guiado

- [ ] **Perguntar e responder pela persona.** Enviar: “Ajude Bruno a planejar para o próximo prazo. Leia os materiais e o calendário selecionados, explique suposições e pergunte sobre informações ausentes que façam diferença.” Manter fatos ausentes desconhecidos e registrar decisões novas. A meta de cinco horas já está no contexto.
- [ ] **Usar o formulário da pergunta.** Escolher/digitar e usar **Enviar resposta**, ou dispensar explicitamente. Isso não aprova calendário. Trocar idioma preserva o rascunho; recarregar pode perdê-lo. A evidência ao vivo cobre uma opção; os outros modos têm testes offline.
- [ ] **Revisar antes de aprovar.** Comparar fontes/prazos, horários, intervalos e horas por matéria no horizonte. A heurística pode produzir divisão desigual sem prioridade e Luna pode descrevê-la de forma excessivamente positiva. Ausência de conflito não comprova personalização ou melhor plano.
- [ ] **Pedir a correção combinada.** Enviar **“Mantenha segunda-feira, 2 de novembro de 2026, livre.”** Esperar nenhum estudo novo nesse dia e compromissos preservados. A revisão observada usou quarta 2h, sábado 2h e domingo 1h, mas outra resposta pode variar. Não corrigir silenciosamente as evidências.
- [ ] **Aprovar só o próximo, se aceitável.** Clicar **Aprovar próxima semana**, deixando **Aprovar blocos futuros** intocado. “Sim” no chat não aprova. Conferir estado aplicado, adições observadas e futuro pendente. A execução registrada adicionou cinco eventos e preservou 146 existentes; conferir sua própria execução.
- [ ] **Registrar cinco observações.** Perguntas, contexto/suposições, viabilidade, correção e clareza da aprovação recebem 0–2 ou N/O. Anotar evidências e falhas técnicas separadamente. Após a tarefa guiada, explorar alterações suportadas no ritmo do grupo. Não tratar parâmetro sem suporte como personalização implementada.

### Encerrar, falhar e recuperar

- [ ] **Encerrar pela página.** Salvar a ficha, clicar **Encerrar e arquivar** e conferir estudante/ID. **Manter execução aberta** cancela. **Confirmar encerramento e arquivar** inicia arquivamento/retirada verificada. Esperar **Nenhuma execução ativa** e **Execução arquivada** antes de outra. Isso não aprova blocos futuros.
- [ ] **Inspecionar antes de repetir uma falha.** Resposta vazia/erro de rede pode ocorrer após efeito. Atualizar e conferir execução/seção. O prompt nativo antigo esgotou tempo mesmo com encerramento concluído; a confirmação na página elimina essa dependência. Não repetir escrita/reset incerto às cegas.
- [ ] **Ler o estado se Enviar estiver desativado.** Sem execução: iniciar. Ocupado: aguardar ou usar cancelamento suportado. Pergunta pendente: responder no formulário. Bloqueio/indisponibilidade: preservar IDs e chamar manutenção. Se Luna falhar, marcar critérios N/O e usar só exercícios determinísticos suportados e identificados. Gateway falso roteirizado não é Luna.
- [ ] **Permanecer bloqueado se a retirada/propriedade for desconhecida.** Preservar trace/estado e pedir inspeção do ciclo confiável. Não trocar diretório para evadir execução, apagar reivindicação ou reiniciar o simulador em memória com a mesma identidade. Reconciliação no lugar e recuperação automática completa estão adiadas. Cancelar não desfaz escrita externa.
- [ ] **Concluir com evidências.** Registrar observado/não observado e preocupações. A sessão não autoriza merge, dados reais ou escolha de fundamento.
