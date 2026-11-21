# Portable synthetic calendar replay

Use a local Docker daemon, the pinned Calendarpit image and the repository's installed Node dependencies. Run these commands from the repository root with new file paths.

```sh
./node_modules/.bin/node scripts/calendar-replay.mjs export bruno /tmp/bruno-checkpoint.json
./node_modules/.bin/node scripts/calendar-replay.mjs replay /tmp/bruno-checkpoint.json /tmp/bruno-child.json
```

Use `ana` for the other fixture. The replay's second path is optional. Each command prints a run ID, checkpoint checksum and retirement status. Existing output files are protected from overwrite. The exported JSON contains fictional event content. Keep it separate from recovery archives and use files from trusted synthetic exports. The checksum detects edits or corruption and provides no proof of authorship.

Replay loads a new simulator, obtains fresh synthetic OAuth, then verifies the provider event pages and stored fixture. The child checkpoint links to its parent. IDs, ownership markers and supported recurrence survive loading. Original ETags and timestamps remain recorded observations. The clock is planning metadata. Calendarpit assigns new ETags and timestamps, and its state export omits some calendar-list settings and tombstones. The CLI reads provider events. Any later provider mutation in a developer test must use an explicit approval scoped to the new run.

On failure, check the reported synthetic run ID. For a reported cleanup failure, inspect `study-calendar-<run-id>` and `study-calendar-net-<run-id>` with Docker and confirm their `study.run.id` labels before retiring the matching resources. Preserve any checkpoint that was already written. The interactive companion continues to use its recovery archive for diagnosis.

## Português

Execute os comandos acima na raiz do repositório com Docker local, a imagem fixada do Calendarpit e as dependências Node instaladas. Use `ana` para testar a outra agenda. O caminho do checkpoint filho é opcional e os comandos preservam arquivos que já existem. Use somente checkpoints sintéticos de origem conhecida, pois eles contêm o texto fictício dos eventos.

A restauração cria outro simulador, obtém nova autorização sintética e confere os eventos paginados e os dados armazenados. O checkpoint filho referencia o pai. Os IDs, marcadores de propriedade e recorrências compatíveis são preservados. Os ETags e horários de criação e alteração originais ficam como observações. Qualquer alteração posterior exige aprovação para a nova execução.

Em caso de falha de limpeza, use o ID informado para inspecionar o contêiner e a rede. Confira os rótulos `study.run.id` antes de remover recursos. Preserve o checkpoint já gravado.

## Integration check

```sh
CALENDARPIT_LIVE_TEST=1 ./node_modules/.bin/node --test tests/calendar-replay.integration.mjs
```
