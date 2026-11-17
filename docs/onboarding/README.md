# Group onboarding / Apresentação do projeto

Verified 17 November 2026. Audience: new project developers. Goal: understand and evaluate the current synthetic demonstration together, using one facilitator computer. The briefing/replay is 25 minutes; hands-on is separately paced. Human workflow scoring remains a group task.

## Open / Abrir

The generated package contains a switchable EN/pt-BR HTML presentation, an actual screenshot replay, self-sufficient facilitator checklist, Bruno facts/unknowns, reusable scorecard, JSON evidence and references. It runs offline once downloaded: unzip and open **index.html**. It does not contain the application, Docker images, credentials or private runtime archives. The capture is explicitly a screenshot replay, not video.

O pacote contém apresentação HTML com troca EN/pt-BR, replay real de capturas, checklist autossuficiente, persona Bruno, ficha reutilizável, evidências JSON e referências. Funciona offline após baixar: extrair e abrir **index.html**. Não inclui aplicação, imagens Docker, credenciais ou arquivos privados. O replay não é vídeo.

For the live exercise, use [the checklist](facilitator-checklist.md) and [local Luna guide](../host-luna-preview.md) on the development computer. Phone previews are read-only. The host fallback, uneven course balance, long-session memory/restart limits and unfinished production capabilities are explicit in the deck and [readiness report](../review/onboarding-readiness-2026-11-17.md).

## Build and update / Gerar e atualizar

From the repository with installed project dependencies, run:

```bash
npm run build:onboarding
```

Outputs: `.runtime/onboarding-package/` and `.runtime/study-atlas-onboarding.zip`. The builder uses Node and the pinned fflate 0.8.3 dev dependency already present in the DSH dependency tree; no additional host archive binary is required. It checks language structure, timing, local links/images and ZIP hash round-trip. The offline CI workflow also runs this build, so structural drift fails the check; semantic translation and visual quality still require review. Run these maintainer build steps in the prepared development environment. Opening the resulting HTML package only requires a browser.

Edit [shared content](presentation/content.json), [client](presentation/app.js), [style](presentation/style.css) and the bilingual Markdown guides. Rebuild, visually inspect both languages and phone layouts, and update `verifiedOn` only after reviewing the current evidence and issue/PR state. Link sources and distinguish actual/model/scripted/human observations. Keep all private runtime/profile data outside the curated list. Refresh the live-head snapshot before any Git operation; the deck is a dated explanation, not a replacement for the Project.

Editar conteúdo compartilhado, código/estilo e guias Markdown. Gerar novamente, verificar ambos os idiomas e celular, e atualizar a data apenas depois de revisar evidências e estado atual dos issues/PRs. Não copiar dados privados. A apresentação é uma explicação datada; o Project continua registrando o trabalho atual.

## Temporary read-only preview / Prévia temporária

The maintainer chooses an explicit network interface, then starts:

```bash
STUDY_PREVIEW_BIND=100.120.7.46 PORT=4179 npm run preview:onboarding
```

This address is the verified Tailscale interface for the 17 November session, not a portable machine identifier. The helper defaults to localhost if no interface is set. It serves only manifest-listed, hash-checked generated files and ZIP. It does not proxy application APIs. POST is rejected. Stop it with Ctrl-C; after rebuilding changed files, restart it so the manifest matches. It is temporary and must be deliberately restarted after shutdown/reboot. No persistent service or public deployment is installed.

A manutenção deve confirmar o IP da máquina antes de reutilizar o comando. A prévia só serve arquivos gerados previstos no manifesto e não encaminha APIs. É temporária; parar com Ctrl-C e reiniciar após gerar mudanças ou desligar/reiniciar a máquina.
