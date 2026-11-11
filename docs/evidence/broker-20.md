# Synthetic broker repetition / Repetição sintética do broker

**Verified / Verificado: 2026-11-11.**

## English

Twenty independent test-controlled environments passed: ten Ana four-week runs and ten Bruno six-week runs. Each used a fresh Calendarpit simulator, copied fictional workspace, SQLite runtime, private broker, separate non-root DSH container and fake model gateway. The pinned DSH SDK executed a scripted three-response model sequence: read calendar, draft a plan, then finish. A separate test action approved only the near-term section.

The assertions cover selected horizons, conflicts with existing calendar commitments, no calendar writes during drafting, preservation of existing events, near-term writes, future section remaining pending, and successful cleanup calls. The agent container had no provider-key file or Docker socket mounted. The [TAP output](broker-20.tap) reports all 20 passes. Reproduce with:

```sh
STUDY_DOCKER_TEST=1 STUDY_DOCKER_REPEATS=10 ./node_modules/.bin/node --test tests/dsh-container.integration.mjs
```

**Limits:** the model is scripted and the approval is test-controlled; no live model or user conversation occurred. These tests use a host-side test controller and bind-mounted host dependencies. They do not exercise the application interface, the standalone run registry's real Docker driver, automatic evidence archival, restart recovery or every failure drill, and do not establish real-provider behavior or security against a privileged host user. The TAP log is test evidence, not the full experiment bundles required by the plan.

## Português brasileiro

Vinte ambientes independentes controlados pelo teste passaram: dez execuções da Ana com horizonte de quatro semanas e dez do Bruno com horizonte de seis semanas. Cada execução utilizou um simulador Calendarpit novo, cópia do espaço fictício, estado SQLite, broker privado, contêiner DSH separado sem privilégios de root e gateway de modelo fictício. O SDK DSH fixado executou uma sequência roteirizada de três respostas: ler o calendário, gerar uma proposta e concluir. Uma ação separada do teste aprovou apenas a seção de curto prazo.

As verificações cobrem os horizontes escolhidos, conflitos com compromissos existentes, ausência de escrita durante a proposta, preservação dos eventos anteriores, escrita do curto prazo, manutenção do futuro como pendente e chamadas de limpeza bem-sucedidas. O contêiner do agente não recebeu o arquivo da chave do provedor nem o socket Docker. A [saída TAP](broker-20.tap) registra as 20 aprovações. Para reproduzir, use o comando acima.

**Limites:** o modelo é roteirizado e a aprovação é controlada pelo teste; não houve modelo real nem conversa com usuário. Os testes usam um controlador de teste na máquina e dependências montadas do host. Não exercitam a interface da aplicação, um controlador Docker real do registro de execuções, arquivamento automático, recuperação após reinício nem todas as falhas previstas; tampouco comprovam o comportamento de provedores reais ou segurança contra usuário privilegiado da máquina. O registro TAP é evidência de teste, não os pacotes completos de experimento previstos no plano.
