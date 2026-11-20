# Structured questions / Perguntas estruturadas

Verified implementation: 17 November 2026, draft PR #39. Delivery: #40; later interface comparison: #44. This is the thin companion, not a final interface selection.

## English

A question is a clarification, never calendar approval. The server binds answers to the selected run and current DSH request. Option labels remain the exact native values; only interface labels are localized. Agent-authored question text is displayed as received, not automatically translated.

| Contract | Companion implementation | Required comparison in #44 |
| --- | --- | --- |
| QW1: choose one, or explicitly type another answer | Radio options, descriptions and custom mode; typed custom text replaces the selection | Verify equivalent native/custom semantics |
| QW2: choose several, optionally add text | Checkboxes plus optional custom text | Verify selected labels and combined text |
| QW3: no offered choices | Typed answer | Verify native result |
| QW4: required answer and bounded text | Each question needs a selection or nonblank text; at most 2,000 typed characters; server validates too | Invalid answers must not advance the conversation |
| QW5: stable draft and identity | Polls preserve controls; EN/pt-BR switching preserves draft; obsolete forms cannot answer a newer request | Test reload/recovery separately; draft persistence across page reload is not provided |
| QW6: dismissal and duplicate prevention | Dedicated dismiss action; single-flight answer/cancel; neither calls approval | Verify cancellation and stale run/request handling |
| QW7: approval distinction | Answer confirmation reminds the facilitator that calendar approval is separate | Only trusted near/future review controls can apply changes |

`tests/managed-ui.test.mjs` connects a dependency-free DOM facade to the real `StudySession.answer`/`cancelQuestion` implementation and inspects DSH RPC frames. It covers all answer forms, descriptions, blank/overlong rejection, polling, language switching, stale forms, duplicate submission and zero approval calls. Existing service/HTTP tests retain stale identity and approval protection. This is automated protocol/DOM evidence, **not** actual-browser, screen-reader or live-model verification. Browser inspection of the new widgets remains required. Native panel PR #34 is a read-only calendar experiment; this change does not implement its conversation UI or establish parity.

## Português

A pergunta esclarece o contexto e **não aprova o calendário**. O servidor vincula a resposta à execução selecionada e à solicitação atual do DSH. Os rótulos das opções são enviados exatamente como recebidos. A interface tem tradução; o texto produzido pelo agente não é traduzido automaticamente.

- **QW1:** uma opção por botões de seleção, ou outra resposta digitada explicitamente.
- **QW2:** várias opções por caixas de seleção, com texto adicional opcional.
- **QW3–4:** texto livre quando não há opções; cada pergunta exige resposta e aceita até 2.000 caracteres digitados.
- **QW5:** atualizações periódicas e troca de idioma preservam o rascunho. Formulários antigos não respondem a novas solicitações. Recarregar a página pode perder o texto ainda não enviado.
- **QW6:** dispensar é uma ação própria. Envios duplicados são bloqueados durante a solicitação.
- **QW7:** responder, inclusive “sim”, não aprova mudanças. Use separadamente **Aprovar próxima semana** e **Aprovar blocos futuros** após revisar.

Os testes automatizados verificam os dados enviados ao protocolo real do DSH, sem usar um modelo. Ainda falta verificar os novos controles em navegador real e com tecnologias assistivas. A comparação equivalente das duas interfaces continua em #44; o painel nativo de #34 permanece um experimento de calendário somente leitura.
