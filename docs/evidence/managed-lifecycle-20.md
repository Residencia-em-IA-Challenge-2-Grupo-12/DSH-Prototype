# Managed synthetic lifecycle: 20 repetitions / Ciclo sintético gerenciado: 20 repetições

**Verified / Verificado: 2026-11-11.**

## English

The experimental trusted controller completed [20 scripted scenarios](managed-lifecycle-20.log): ten Ana runs with a four-week outlook and ten Bruno runs with a six-week outlook. Each reserved a unique identity, started an isolated Calendarpit instance, copied the selected fictional workspace, ran the packaged DSH agent against a fake model gateway, and created a private state store. The test confirmed that drafting made no calendar writes and checked the proposed near-term blocks against existing commitments. A separate test action approved the near-term section; existing events remained unchanged and future changes stayed pending. Each run drained the service, archived its synthetic evidence, removed its labelled agent and simulator resources, and verified retirement before allowing a replacement.

In a separate Docker crash drill, the controller was killed after Calendarpit accepted a write but before the application received its response. A new controller preserved the approved claim as sent, observed the event without retrying, and retired the old resources before creating another run. The observation is a point-in-time snapshot, not proof against delayed effects.

A separate managed Docker drill removed the simulator before retirement. The archive recorded the observation as unavailable, with no event list, rather than portraying it as an empty calendar.

The model messages and approvals were scripted. These tests do **not** demonstrate a real conversation, a live provider, the current browser interface, or complete recovery from interruptions during startup or retirement. Test archives were inspected and then removed with their temporary directories; they are not the full experiment bundles required for comparison. The broader failure-drill and live-model suites remain incomplete.

To reproduce on the development host after building the agent image:

```sh
STUDY_DOCKER_TEST=1 STUDY_MANAGED_REPEATS=10 STUDY_DSH_IMAGE=study-dsh-agent:synthetic ./node_modules/.bin/node --test --test-concurrency=1 --test-name-pattern='trusted lifecycle:' tests/synthetic-run-driver.integration.mjs
STUDY_DOCKER_TEST=1 STUDY_DSH_IMAGE=study-dsh-agent:synthetic ./node_modules/.bin/node --test --test-name-pattern='crashed controller' tests/synthetic-run-driver.integration.mjs
STUDY_DOCKER_TEST=1 STUDY_DSH_IMAGE=study-dsh-agent:synthetic ./node_modules/.bin/node --test --test-name-pattern='unavailable simulator' tests/synthetic-run-driver.integration.mjs
docker build -f tests/fixtures/Dockerfile.broken-policy -t study-dsh-agent:broken-policy .
STUDY_DOCKER_TEST=1 STUDY_BAD_DSH_IMAGE=study-dsh-agent:broken-policy ./node_modules/.bin/node --test --test-name-pattern='policy plugin fails' tests/synthetic-run-driver.integration.mjs
```

The observed packaged agent image ID for the 20 runs was `sha256:d2d4145fb529319a3fe885ddf6cf2d9e25b15912f06812da13c4d6cde37069ae`. After those runs, an updated image added a tool-policy startup check. Both personas and the crash drill passed again; a deliberately broken-policy image was rejected before generating a proposal or changing the calendar. The gateway contained only synthetic credentials and test responses; no paid request was made.

## Português brasileiro

O controlador confiável experimental concluiu [20 cenários roteirizados](managed-lifecycle-20.log): dez execuções da Ana com horizonte de quatro semanas e dez do Bruno com horizonte de seis semanas. Cada uma reservou uma identidade única, iniciou um Calendarpit isolado, copiou o espaço fictício selecionado, executou o DSH empacotado com um gateway de modelo simulado e criou um banco privado. O teste verificou que a proposta não escreveu no calendário e comparou os blocos de curto prazo com os compromissos existentes. Uma ação separada do teste aprovou o curto prazo; os eventos existentes permaneceram inalterados e o futuro ficou pendente. Cada execução aguardou o serviço, arquivou suas evidências sintéticas, removeu os recursos identificados do agente e do simulador e verificou o encerramento antes de permitir outra execução.

Em outro teste Docker, o controlador foi interrompido depois que o Calendarpit aceitou uma escrita e antes que a aplicação recebesse a resposta. Um novo controlador preservou a ação aprovada como enviada, observou o evento sem repetir a escrita e encerrou os recursos antigos antes de iniciar outra execução. A observação é um retrato do momento e não garante que não possa haver efeito atrasado.

Em outro teste Docker gerenciado, o simulador foi removido antes do encerramento. O arquivo registrou a observação como indisponível, sem uma lista de eventos, em vez de apresentá-la como calendário vazio.

As respostas do modelo e as aprovações foram roteirizadas. Esses testes **não** demonstram conversa real, provedor real, a interface atual do navegador ou recuperação completa de interrupções durante inicialização e encerramento. Os arquivos de teste foram inspecionados e removidos junto aos diretórios temporários; não são os pacotes completos de experimentos exigidos para a comparação. Os demais testes de falha e as execuções com modelos reais continuam pendentes. Para reproduzir, use os comandos da seção em inglês. O gateway utilizou somente credenciais e respostas fictícias; nenhuma chamada paga foi feita.
