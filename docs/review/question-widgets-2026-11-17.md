# Question controls and runtime finding / Perguntas e execução

Verified 17 November 2026. This bounded follow-up implements #40's companion question controls and specifies shared acceptance for #44. It does not select an interface, integrate branches or authorize a merge. Code: `39cfc810acae441d4c70eadd59d1a91a067b3697`, stacked on #38. [Machine-readable results and logs](../evidence/question-widgets-2026-11-17/summary.json).

## English

Previously, the companion displayed DSH options as text and always submitted a typed answer with an empty selection array. It now renders single-choice radio buttons, multiple-choice checkboxes, option descriptions, typed alternatives and a distinct dismissal action. Submitted labels and custom text reach the actual native DSH answer contract. Questions remain separate from calendar approval.

The new regression first failed because the expected choice controls were absent. It now passes against the real `StudySession` answer/cancel implementation. All **157 offline tests pass**. Coverage includes blank and overlong answers, retained drafts across polling/language changes, obsolete forms, duplicate submissions and zero calendar approval calls. No new model call was needed. [Bilingual contract and comparison checklist](../question-widget-contract.md).

| Acceptance | Current result |
| --- | --- |
| Pick one, pick several, type or dismiss | Implemented; automated DOM/protocol checks pass. |
| EN/pt-BR interface labels and draft preservation | Implemented and tested; agent-authored text is displayed as received. |
| Actual browser usability/accessibility of these new controls | Not observed. Earlier human calendar/layout feedback does not verify them. |
| Equivalent native/custom workflow | Unmet; #34 remains a read-only native calendar experiment, #44 retains comparison and selection. |
| Explicit near-only Luna browser write | Still unobserved; future must remain pending. |
| Recording/replay and final bilingual package | Still incomplete under #40. |

### Separate simulator failure

The existing Bruno run `d2ba3486-3a79-4b33-864c-f24adab60ea5` was idle when inspected. Docker reported its pinned Calendarpit container **OOMKilled=true, exit 137**, after approximately 61 minutes at the configured 512 MiB cap. The calendar was unavailable; both sections remained pending, with no current or historical write claim. This is not an approval failure and occurred before these widget changes. We have not established what caused the memory growth or fixed long-session stability.

Synthetic conversation/trace, state and bounded Docker diagnostics were preserved privately. Trusted retirement stopped writers, created a conservative archive with `availability: unavailable` and `events: null`, then verified the old container/network absent. The archive hash is in the result JSON. No evidence was discarded, no uncertain write was retried and no empty simulator was restarted under the old identity. Rich experiment evidence remains separate from the conservative archive.

The live application has no active run. Start Bruno shortly before the next exercise; this avoids leaving an unnecessary simulator running but does not establish a memory fix. #11 records the need for a bounded reproduction that measures memory against request/idle time, tests the intended group-session duration and decides whether an upstream/configuration fix is justified. Keep this distinct from a broad runtime redesign.

### Handoff

Reload [the local facilitator interface](http://127.0.0.1:4176/), start Bruno and follow [the launch/exercise checklist](../host-luna-preview.md). Try the offered question controls, request the Monday correction, review the resulting week, then explicitly click **Approve coming week** only. Confirm observed additions and **Future tentative blocks: pending**. Leave the run open for inspection if anything fails. Browser-control access remains unavailable in this chat, so human inspection is required; automated tests are not a screen recording.

The [Tailscale preview](http://100.120.7.46:4178/) is a read-only archived example, not this live exercise or a question-widget demo. Assets and POST rejection were verified from this host. Local controls remain loopback-only; there is no LAN control link. Both preview processes are temporary and need deliberate restart after shutdown/reboot.

## Português

A interface antes mostrava as opções do DSH como texto e enviava apenas a resposta digitada. Agora oferece **uma opção, várias opções, outra resposta digitada e dispensar pergunta**, com descrições das opções. Os dados enviados seguem o contrato nativo do DSH. Responder “sim” continua sem aprovar o calendário.

Os **157 testes offline passaram**, incluindo o envio ao protocolo real, rascunhos preservados nas atualizações e na troca de idioma, validação, formulários antigos e bloqueio de envio duplicado. Falta verificar os novos controles em navegador real e com tecnologias assistivas. O painel nativo continua sendo um experimento somente leitura; a comparação das interfaces permanece em #44.

Também encontramos uma falha independente: o simulador da execução anterior foi encerrado por falta de memória. Preservamos as evidências e arquivamos a observação como **indisponível**, sem inventar um calendário vazio. O encerramento confiável verificou a remoção dos recursos antigos. As duas seções estavam pendentes e não havia registro de tentativa de escrita. Ainda não há correção comprovada para sessões longas; #11 acompanha a investigação delimitada.

Para a próxima verificação, abra a interface local, inicie Bruno, teste a pergunta, peça para manter **segunda-feira, 2 de novembro de 2026, livre**, revise e use apenas **Aprovar próxima semana**. Confira os eventos realmente observados e mantenha os blocos futuros pendentes. Se houver falha, deixe a execução aberta. A gravação/replay e o pacote bilíngue final continuam pendentes. Nenhum PR foi mesclado e nenhuma escolha de arquitetura foi feita nesta etapa.
