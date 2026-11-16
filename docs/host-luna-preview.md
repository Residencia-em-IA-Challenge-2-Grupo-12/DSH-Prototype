# Local Luna browser preview / Prévia local Luna

Verified commands and infrastructure: 16 November 2026. Experimental, synthetic Bruno only. This is the authorized **host fallback**, not the managed Docker-agent route: DSH and the trusted controller run on the host; Calendarpit runs in a disposable pinned container. General Bash/native host-access tools stay disabled in the agent. The actual eight-tool catalog probe passed.

## Start / Iniciar

From the draft worktree with installed project dependencies and Docker available:

```bash
STUDY_LUNA_DSH_HOME=/absolute/path/to/existing/dsh-profile \
  ./node_modules/.bin/node scripts/preview-luna-synthetic.mjs
```

Use the existing authenticated profile directory; never copy its credential files to a fixture, archive, Git or chat. The operator configures this trusted path locally, not through browser/model input. The process uses Codex/GPT-6 Luna only; no OpenRouter key or fallback is needed for this route. Reauthenticate personally only if the existing login fails.

Open **http://127.0.0.1:4176/** on the facilitator machine. The default private lifecycle root is `/tmp/study-luna-<uid>` to fit Unix socket limits; `STUDY_RUN_ROOT` may select another short absolute private path. Reuse that root for restart inspection. Do not choose a new root to evade an unresolved run. It is a temporary development location, not a backup policy; retain important sanitized evidence deliberately before machine cleanup/reboot.

The web process receives a private fixed-operation controller socket, not Docker authority or the credential profile. Controls remain bound to loopback with exact origin/Host checks. No LAN/Tailscale control link is exposed. Another device's localhost is not this machine. Persistent service installation or remote control is outside this helper.

## Exercise / Exercício

1. Confirm the header says **Host Luna fallback**; start Bruno. Starting creates fictional state/workspace/calendar but makes no model call.
2. Ask for context inspection, a useful question, the coming week and a six-week outlook. Answer from [Bruno's facts/unknowns](onboarding/bruno-persona.md).
3. Review the proposal and weekly overlay; request **“Keep Monday, 2 November 2026 free.”** The simulation date stays 2 November regardless of the host date.
4. Review the corrected allocations. If acceptable, click **Approve coming week / Aprovar próxima semana**. A reply in chat—including “yes”—does not approve. Leave **Approve future blocks / Aprovar blocos futuros** untouched.
5. Confirm Coming week is applied and the observed calendar includes those additions; future remains pending. Preserve errors and ask for inspection before retrying unknown writes.
6. Fill the [scorecard](onboarding/scorecard.md). End/archive through the run control. Ordinary replacement is permitted only after evidence archival and verified retirement. SIGINT/SIGTERM also attempts retirement and reports a block if it cannot be verified.

A known same-process pre-service startup failure can now archive available state and an unavailable observation, then verify cleanup. A restarted controller does **not** guess old host-writer identity; interrupted/unknown states can remain blocked. Preserve the run and involve the maintainer. Never delete claims, lifecycle databases, sockets or named resources merely to permit another run. In-place calendar reconciliation and complete automated restart recovery are not provided.

## Evidence / Evidências

Each run has a private SQLite state/workspace, `experiments/<attempt>/trace.jsonl` and a conservative recovery archive on retirement. Credentials and the synthetic authorization seed are not part of the experiment export. Trace conversation comes from bounded SDK snapshots and may omit/truncate events; usage can be unknown. Do not describe authored-response tests as live Luna behavior.

See [the current review](review/readiness-2026-11-16.md) for test layers, actual user feedback, remaining capture/package gaps and merge gates. The local preview is temporary; after shutdown/reboot it must be deliberately started again.

**Português:** use a pasta do perfil já autenticado, sem copiar credenciais. Abra o endereço local na máquina do facilitador; outra máquina não acessa essa prévia por localhost. Inicie Bruno, converse com os fatos fictícios, peça a correção e use o botão **Aprovar próxima semana**; responder “sim” no chat não altera o calendário. O futuro permanece pendente. Confira o resultado real e arquive ao terminar. Se houver estado desconhecido ou recuperação bloqueada, preserve as evidências e chame a manutenção; não apague estado para forçar uma nova execução.
