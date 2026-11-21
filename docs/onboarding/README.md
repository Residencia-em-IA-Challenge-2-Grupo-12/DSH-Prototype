# Group onboarding / Apresentação do projeto

Verified 20 November 2026. The 25-minute bilingual briefing uses the pinned cold-start browser build. One facilitator controls the synthetic Bruno session and the group observes. The fixed Ana exercise follows separately.

## Open / Abrir

Unzip the package and open **index.html**. It includes the six-scene browser walkthrough, the [exercise cards](browser-exercises.md), the [facilitator checklist](facilitator-checklist.md), the [scorecard](scorecard.md) and curated synthetic evidence. The deck and included material work offline. Live controls use the development computer.

Extraia o pacote e abra **index.html**. Veja as seis cenas do navegador, os [exercícios](browser-exercises.md), o [checklist](facilitator-checklist.md), a [ficha](scorecard.md) e as evidências sintéticas selecionadas. Os materiais incluídos funcionam offline. Use o computador de desenvolvimento para a prática ao vivo.

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
STUDY_PREVIEW_BIND=100.120.7.46 PORT=4193 npm run preview:onboarding
```

This address is the verified Tailscale interface for the 20 November rehearsal, not a portable machine identifier. The helper defaults to localhost if no interface is set. It serves only manifest-listed, hash-checked generated files and ZIP. It does not proxy application APIs. POST is rejected. Stop it with Ctrl-C; after rebuilding changed files, restart it so the manifest matches. It is temporary and must be deliberately restarted after shutdown/reboot. No persistent service or public deployment is installed.

A manutenção deve confirmar o IP da máquina antes de reutilizar o comando. A prévia só serve arquivos gerados previstos no manifesto e não encaminha APIs. É temporária; parar com Ctrl-C e reiniciar após gerar mudanças ou desligar/reiniciar a máquina.
