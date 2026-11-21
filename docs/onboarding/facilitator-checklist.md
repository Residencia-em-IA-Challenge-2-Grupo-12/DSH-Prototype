# Facilitator checklist / Checklist do facilitador

## English

- [ ] **Prepare the briefing.** Open the bilingual deck, browser walkthrough, [exercise cards](browser-exercises.md) and a copy of the [scorecard](scorecard.md). Allow 20–30 minutes for the briefing and schedule hands-on time separately.
- [ ] **Verify the build.** The group rehearsal uses application commit `83c65faaf6a85c04f247760825ff33dec551f6a9`. Start the cold-start browser companion with the existing local Luna profile, Docker, Node 24 dependencies and Poppler. Run on the facilitator machine.

```sh
PORT=4192 STUDY_COLD_CASE=bruno-text STUDY_RUN_ROOT=/tmp/study-group-rehearse \
  STUDY_LUNA_DSH_HOME=/absolute/path/to/local/dsh-profile \
  ./node_modules/.bin/node scripts/preview-luna-synthetic.mjs
```

- [ ] **Check the runtime and run identity.** Open [the local controls](http://127.0.0.1:4192/). Expect Host Luna fallback, a synthetic Bruno case, and no active run. The operator uses the local browser. The portable materials and remote preview are read-only. Reuse a ready launcher if one already exists for the rehearsal. Preserve any unrelated active run.
- [ ] **Brief people on evidence.** The deck includes scripted interaction captures and a live Luna rehearsal with prepared fictional answers. Record assistance and decisions made by the operator. If the agent repeats a deadline question, answer it directly using the dated source. A window starting exactly when a commute ends is adjacent.
- [ ] **Run Bruno first.** Answer a consequential question, open a source and request the Monday correction. Ask what **Confirm planning inputs** will change before using it. Ask for a draft. Predict and verify the effect of **Approve coming week**. Keep future approval pending.
- [ ] **Run the fixed Ana exercise next.** Use the same coverage capture for every operator. Ask which source to trust and which course has zero hours. Record whether they spotted it and what they would ask the agent to change.
- [ ] **Capture the result.** Record time, wrong turns, help and observed consequences. Keep live model and fixed-task observations separate. Retain the five ratings in the scorecard and mark unobserved criteria N/O.
- [ ] **End through the browser.** Review the run ID and confirm archival. Expect the slot to become empty. If the provider, retirement or an approval is uncertain, preserve the run and involve the maintainer before another write. An unavailable observation is unknown.
- [ ] **Handle a failed live run.** Use the included read-only captures, mark the live criteria N/O, and record the failure. The host DSH/controller and Docker Calendarpit are the verified runtime. A previous long idle simulator session hit its 512 MiB limit. Start the fixture shortly before the group uses it.

[Technical launch and repeatable browser tests](../cold-start-browser-review.md)

## Português brasileiro

- [ ] **Preparar a apresentação.** Abra a apresentação bilíngue, a sequência de capturas, os [exercícios](browser-exercises.md) e uma cópia da [ficha](scorecard.md). Reserve 20–30 minutos para a apresentação. Planeje a prática separadamente.
- [ ] **Conferir a versão.** Use o commit `83c65faaf6a85c04f247760825ff33dec551f6a9` para a aplicação. Execute o comando acima no computador do facilitador com perfil local Luna, Docker, dependências Node 24 e Poppler.
- [ ] **Conferir ambiente e identidade.** Abra [os controles locais](http://127.0.0.1:4192/). Confira a indicação de Luna no host, o cenário sintético de Bruno e a ausência de execução ativa. O operador usa o navegador local. Os materiais portáteis e a prévia remota são somente leitura. Se o ambiente do ensaio já estiver pronto, reutilize-o. Preserve uma execução ativa de outro exercício.
- [ ] **Explicar as evidências.** A apresentação tem capturas roteirizadas e um ensaio Luna ao vivo com respostas fictícias preparadas. Registre decisões do operador e qualquer ajuda dada. Se o agente repetir uma pergunta sobre o prazo, responda com a fonte datada. Uma janela que começa exatamente quando o deslocamento termina é adjacente.
- [ ] **Começar por Bruno.** Responda à pergunta, abra uma fonte e peça a correção das segundas. Pergunte o que **Confirmar dados do plano** fará antes de clicar. Peça a proposta. Preveja e verifique o efeito de **Aprovar próxima semana**. Deixe a aprovação futura pendente.
- [ ] **Fazer o exercício fixo de Ana.** Use a mesma captura para todos os operadores. Pergunte qual fonte usar e qual matéria ficou sem horas. Registre se perceberam a lacuna e o que pediriam ao agente.
- [ ] **Registrar o resultado.** Anote tempo, tentativas, ajuda e efeitos observados. Separe observações do modelo ao vivo e da tarefa fixa. Mantenha as cinco notas da ficha e marque N/O para critérios não observados.
- [ ] **Encerrar pela página.** Confira o ID da execução e confirme o arquivamento. A execução ativa deve ficar vazia. Se houver incerteza na aprovação, no simulador ou no encerramento, preserve o estado e procure a manutenção antes de outra escrita.
- [ ] **Se a execução ao vivo falhar.** Use a sequência de capturas e marque N/O nos critérios ao vivo. O ambiente verificado usa DSH/controlador no host e Calendarpit no Docker. Uma execução ociosa anterior atingiu o limite de 512 MiB. Inicie o cenário perto da hora de uso.

[Preparação técnica e testes repetíveis no navegador](../cold-start-browser-review.md)
