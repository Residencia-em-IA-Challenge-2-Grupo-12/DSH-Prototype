# Synthetic broker repetition / Repetição sintética do broker

**Verified / Verificado: 2026-11-11.**

## English

Twenty independent test-controlled environments passed: ten Ana four-week runs and ten Bruno six-week runs. Each used a fresh Calendarpit simulator, copied fictional workspace, SQLite runtime, private broker, separate non-root DSH container and fake model gateway. The pinned DSH SDK executed a scripted three-response model sequence: read calendar, draft a plan, then finish. A separate test action approved only the near-term section.

The assertions cover selected horizons, conflicts with existing calendar commitments, no calendar writes during drafting, preservation of existing events, near-term writes, future section remaining pending, and successful cleanup calls. The agent container had no provider-key file or Docker socket mounted. The [TAP output](broker-20.tap) reports all 20 passes. Reproduce with:

```sh
STUDY_DOCKER_TEST=1 STUDY_DOCKER_REPEATS=10 ./node_modules/.bin/node --test tests/dsh-container.integration.mjs
```

The same 20 scenarios were then repeated successfully with DSH and its dependencies installed inside the [experimental agent image](../../Dockerfile.agent), without mounting host dependencies or application source into the agent. A synthetic test probe and the private broker socket were mounted. See [the packaged-image TAP output](broker-20-packaged.tap). The observed local image ID was `sha256:fbb9bf39e0a8a01653c99a24777ba7534de862d376ad42f590ebff6e5109cc48`; the lockfile SHA-256 was `52f8cb1067abe31ec8566686a60600574fabfbc302655062f457d7e68fae0110`. Reproduce by building the image and setting `STUDY_DSH_IMAGE`:

```sh
docker build -f Dockerfile.agent -t study-dsh-agent:synthetic .
STUDY_DOCKER_TEST=1 STUDY_DOCKER_REPEATS=10 STUDY_DSH_IMAGE=study-dsh-agent:synthetic ./node_modules/.bin/node --test tests/dsh-container.integration.mjs
```

**Limits:** the model is scripted and the approval is test-controlled; no live model or user conversation occurred. Both tests use a host-side test controller; the fake gateway also mounts test source. They do not exercise the application interface, the standalone run registry's real Docker driver, automatic evidence archival, restart recovery or every failure drill, and do not establish real-provider behavior or security against a privileged host user. The TAP logs are test evidence, not the full experiment bundles required by the plan.

## Português brasileiro

Vinte ambientes independentes controlados pelo teste passaram: dez execuções da Ana com horizonte de quatro semanas e dez do Bruno com horizonte de seis semanas. Cada execução utilizou um simulador Calendarpit novo, cópia do espaço fictício, estado SQLite, broker privado, contêiner DSH separado sem privilégios de root e gateway de modelo fictício. O SDK DSH fixado executou uma sequência roteirizada de três respostas: ler o calendário, gerar uma proposta e concluir. Uma ação separada do teste aprovou apenas a seção de curto prazo.

As verificações cobrem os horizontes escolhidos, conflitos com compromissos existentes, ausência de escrita durante a proposta, preservação dos eventos anteriores, escrita do curto prazo, manutenção do futuro como pendente e chamadas de limpeza bem-sucedidas. O contêiner do agente não recebeu o arquivo da chave do provedor nem o socket Docker. A [saída TAP](broker-20.tap) registra as 20 aprovações. Para reproduzir, use o comando acima.

Os mesmos 20 cenários também passaram com o DSH e suas dependências instalados dentro da [imagem experimental do agente](../../Dockerfile.agent), sem montar o código da aplicação ou as dependências do host no contêiner do agente. Foram montados uma sonda de teste fictícia e o socket privado do broker. Veja a [saída TAP da imagem empacotada](broker-20-packaged.tap). Os comandos para reconstrução e reprodução estão na seção em inglês; o identificador da imagem e o hash do arquivo de dependências também estão registrados lá.

**Limites:** o modelo é roteirizado e a aprovação é controlada pelo teste; não houve modelo real nem conversa com usuário. Ambos os testes usam um controlador de teste na máquina; o gateway fictício também monta código de teste. Não exercitam a interface da aplicação, um controlador Docker real do registro de execuções, arquivamento automático, recuperação após reinício nem todas as falhas previstas; tampouco comprovam o comportamento de provedores reais ou segurança contra usuário privilegiado da máquina. Os registros TAP são evidências de teste, não os pacotes completos de experimento previstos no plano.
