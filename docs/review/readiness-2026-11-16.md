# Bounded baseline review — 16 November 2026

This report supports #36/#40/#41 and the #9 readiness gate. No merge, retarget, branch rewrite, PR closure, foundation selection or real-data authorization occurred. Dates use America/Sao_Paulo. The source branches and experiments remain preserved.

## Pinned review units

| Unit | Base | Reviewed head | Scope |
| --- | --- | --- | --- |
| #37 | #8 `6bce31c1ab13` | `bad383e8721b` | SQLite state, claims, concurrent updates, truthful unknown/partial outcomes. |
| #38 | #37 `bad383e8721b` | `38da40034632` | Disposable lifecycle, provider API, broker, evidence and model gateway. |
| #39 before this round | #38 `38da40034632` | `7785cb0e75a5` | Browser/controller connection, Luna fallback probes and handoff organization. |

Two economical Luna subagents performed separate read-only standards/spec passes over the three fixed ranges. The primary agent inspected findings and runtime seams, verified the measured defect and reviewed the bounded follow-up patches. This is a scoped readiness review, not an exhaustive security audit or proof of every original requirement.

## Standards

No hard documented-standard violation was identified in the bounded runtime/test pass. One maintainability finding was measured: three independent runtime directories retained nine SQLite/WAL/shared-memory file descriptors in one process. The process-global runtime cache and driver-owned claim/archive stores lacked disposal.

Commit `548d048` adds idempotent store close, exact runtime-cache eviction and disposal after verified resource retirement. Temporary archive stores close after archival; live run stores survive the archive/retry window. A regression checks four runtime archive/retirement cycles and descriptor release. The final offline suite passes 156 tests. The issue was small for a single short session but material for repeated long-running demonstrations.

## Spec

- **Met in the reviewed path:** run identity checks, approval separate from agent tools, intent/claim persistence before provider mutations, ETag-aware adapter, provider/admin separation, unavailable observations, no blind retry and explicit no-fallback routing. The managed gateway is not the Luna subscription route.
- **Known limitation:** a managed controller interrupted during `retiring` remains blocked; managed startup failure also refuses ordinary retirement. This is safe fail-closed behavior, not complete facilitator recovery. It requires an explicit readiness disposition and a scoped follow-up; no claim was cleared to make the test green. Full automated recovery and in-place calendar reconciliation remain deferred.
- **Host fallback:** commit `d2b93d6` adds a separate host-Luna driver and local launcher using the same broker, trusted approval/state service, private controller RPC and browser adapter. DSH/controller stay on the host; only Calendarpit is containerized. An old host process is never reconstructed or trusted on restart. Unknown writer identity remains blocked.
- **Fixed before delivery:** a known same-process host startup failure before service creation can preserve the healthy trace/available state, record the calendar as unavailable, archive and verify retirement. A real-Calendarpit regression forces OAuth setup failure and checks resource absence before another run starts. Trace failure/unknown ownership still blocks replacement.

## Test evidence

[Machine-readable summary](../evidence/readiness-2026-11-16/summary.json) links the logs and file hashes.

| Layer | Result and limit |
| --- | --- |
| Offline suite | 156 passing, no failures. Includes stable UI polling, distinct approvals, duplicate-click protection, safe text formatting, week projection and SQLite disposal. Initial restricted-shell invocation lacked local IPC permissions; the invocation with the required local permissions passed. |
| Actual subscription catalog | Exactly eight agent-visible tools; extra/global tools denied; host clock not injected; zero generative requests in this probe. |
| Disposable managed batch | 20 fresh runs passed: ten Ana and ten Bruno. Each used real Calendarpit, SQLite, broker and separate approval with an authored fake upstream, then verified retirement. The immutable rebuilt image is recorded. This batch predates the final UI/prompt wording correction and does not establish live-model behavior. |
| Host HTTP integration | Two passing real-simulator tests: scripted question → proposal → Monday correction → stale-approval rejection → near-only write → archive/retirement; and pre-service startup failure → truthful archive → verified cleanup → new run. No subscription/model is used by these tests. |
| Actual browser interaction | One user-operated Luna attempt, described below. It is incomplete as a calendar-write walkthrough. |
| Visual browser/recording | Browser-control connector unavailable. Local HTML/module/CSS assets load and DOM/model tests pass, but visual correctness of the revised UI needs human confirmation. No recording was fabricated. |

The 20-run test image is immutable and separate from the older `study-dsh-agent:synthetic` tag. Rebuilding an image and passing scripted infrastructure tests does not establish host subscription isolation or a final Docker deployment.

## What the human walkthrough taught us

Run `6699a42f-d56b-4af7-a6ec-ef0e06d93844` used the real existing Luna subscription. Its trace contains context/calendar reads, one native question and answer, and two proposal drafts. The Monday correction left zero study additions on 2 November. Independent checking found no calendar conflicts. The facilitator ended/archived the run reporting that changes seemed unable to apply and the interface was poor.

The facilitator then clarified that they **replied in chat only**, rather than clicking the separate approval control. The archive contains zero approval decisions, zero write attempts, no unresolved claim and both sections pending. Event IDs, summaries and descriptions match the earlier observation. This is an approval-handoff usability failure, not evidence of a failed provider write. Do not count the attempt as a completed approved-write walkthrough.

[Sanitized attempt extract](../evidence/readiness-2026-11-16/luna-browser-attempt.json) preserves the outcome and bounded conversation. The richer trace/recovery archive is retained privately under `.runtime/experiments/`; it excludes the persistent login and synthetic OAuth control seed. Active model time and subscription usage are unknown; elapsed wall time includes human interaction. Exact initial preview source hashes were not captured, and the corrected UI must not be portrayed as the interface used in this attempt.

## Bounded usability correction

The earlier page was a thin integration carrier: timestamp lists, raw tool names, unformatted Markdown and approval controls easily lost below long event lists. A separate concrete instability rebuilt all approval controls every two seconds, even on identical state. That was not the cause of this user's no-write outcome, but was independently fixed and regression-tested.

The current carrier adds:

- A proportional weekly calendar, week navigation, local times and separate observed/proposed/removal styles. Future weeks remain previews until separately approved. Overnight/all-day boundaries are tested; no third-party calendar account is embedded.
- Explicit **Approve coming week** / **Approve future blocks** controls above the calendar, with counts, hours and expandable changes. Chat-only confirmation still cannot approve.
- Stable unchanged controls across polls, single-flight approval, retained outcome/error messages, question form preservation and working/waiting status.
- Text-safe headings/bold/lists/links and collapsed tool activity, plus English/pt-BR labels. Raw model HTML and unsafe link schemes remain inert.
- Agent guidance directing the facilitator to the actual approval controls rather than repeatedly treating chat confirmation as a write instruction.

The view consumes observed provider-API data and proposal revisions. Calendarpit is the data simulator; a later Google connector can feed the same view after the separate real-data readiness decision. This does not select the final native-versus-custom interface; #44 retains that comparison. Drag/resize, a new planner and study-method personalization are not added.

## Readiness and remaining decisions

| Acceptance | Status |
| --- | --- |
| Current organization/handoff, source preservation and scoped review | Met for this bounded round; broader #41 consolidation/disposition review remains open. |
| Repeated isolated runs and tested approval/write boundaries | Met by deterministic tests at recorded configurations. |
| Luna browser context, question, proposal and Monday revision | Observed in one actual user attempt; usability flags retained. |
| One real Luna browser run with explicit near-only approval and observed writes | Unmet. The first run had no approval attempt. |
| Revised visual layout / approval handoff | Implemented and DOM/data tested; human visual confirmation pending. |
| Representative recording or honestly labeled screenshot replay | Unmet; connector capture unavailable. |
| Final bilingual presentation/offline package | Unmet. Checklist/persona/scorecard drafts are supporting material, not the final package. |
| Complete Docker stack / automated interrupted-lifecycle recovery | Not established; retain disclosed exceptions and a scoped acceptance disposition. |
| #8 merge | Not authorized; stays draft pending integrated readiness and explicit user decision. |

## Exact candidate Git sequence — proposal, not executed

Preserve ancestry rather than squash the dependency-heavy stack. After review/approval of these operations:

1. Merge #39 into its immediate parent #38; inspect #38's resulting effective diff against #37 and CI.
2. Merge #38 into #37; inspect #37's resulting diff against #8 and CI.
3. Merge #37 into #8; inspect #8's resulting diff against main, verify the intended tree and run affected integration/safety checks.
4. Present the final #8 report, known limitations and exact head for the user's **separate #8 → main decision**.

If a resulting tree/configuration differs from tested evidence, revalidate the affected paths. Tree-identical evidence can be reused with the matching hash and configuration explicitly recorded. Stop on unexpected changes or failed checks. Record source heads before operations; keep branches until preservation/disposition is accepted. Merging a child changes its parent's review scope and may change GitHub's merged-state handling for dependent PRs.

No operation on the other twenty experiment PRs is needed to finish this baseline. Their unique tests/results remain reachable; individual supersession/retargeting requires its own reviewed mapping. Presentation polish could follow code readiness only through an explicit disposition of the existing #40/#9 gate; this report does not silently change that agreement.

## Português

A rodada corrigiu vazamento de conexões SQLite, conectou o fallback Luna à interface local e verificou 20 execuções gerenciadas descartáveis, 156 testes offline e dois testes reais do simulador/HTTP. As respostas dos testes de infraestrutura são roteirizadas; a tentativa humana usou Luna real.

Na tentativa humana, houve pergunta, resposta e revisão para liberar a segunda-feira, mas nenhuma aprovação de calendário: a confirmação foi enviada apenas na conversa. O arquivo contém zero tentativas de escrita e ambos os grupos pendentes. Isso expôs uma falha de clareza da interface, não uma falha comprovada de escrita no provedor.

A interface foi ajustada com calendário semanal proporcional, prévias distintas, botões de aprovação explícitos e estáveis, texto formatado com segurança e atividade técnica recolhida. Ainda faltam confirmação visual, uma tentativa Luna com aprovação explícita próxima/aplicação observada, captura/gravação e o pacote final. Não houve merge nem escolha de fundamentos. A sequência de integração acima é proposta para revisão; #8 continua exigindo decisão explícita.
