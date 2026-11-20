## Outcome and scope

Finish the facilitator-operated synthetic Bruno browser walkthrough and the portable bilingual group package. This is the remaining delivery work under #9, not a new interface selection. Implementation is stacked in #39 → #38 → #37 → #8; these changes are not already merged into the baseline.

## Verified starting point — 13 November 2026

- Scripted browser integration completed context → question → plan → Monday correction → near-only approval.
- Two real GPT-6 Luna **API** attempts completed the same loop with prepared fictional answers and test-driver approval in 44.8s and 47.5s. Existing events were preserved, five near events were observed, future remained pending and both runs were archived/retired.
- Actual subscription-loaded tool/pre-step probe passes with eight agent-visible tools; 150 offline checks pass locally. The competing host-clock injection was corrected. This is not a human Luna browser walkthrough or full Docker deployment proof.
- Persona/checklist/scorecard drafts exist; recording, captions, final switchable presentation and portable package remain incomplete.

Evidence: [schedule review](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/fb89772/docs/onboarding/luna-schedule-review.md), [companion status](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/fb89772/docs/managed-companion-progress.md).

## Acceptance

- [x] Connect and verify Luna through the browser for Bruno: inspect context, consequential question, proposal, Monday 2 November exclusion, correction and separate near/future review.
- [x] Apply only reviewed near-term changes through the trusted approval service; observe actual simulator results and future pending. Keep stale/unknown/partial safeguards and meaningful error messages. Preserve all attempts.
- [x] Show runtime accurately: target managed Docker, with the already approved explicitly labeled synthetic host fallback when necessary. One local facilitator; no real accounts/files or new remote-control exposure.
- [ ] Verify continuous recording support; retain a representative actual recording with bilingual captions/disclosed cuts, or document the blocker and use the approved honestly labeled screenshot replay. An API extract is not a recording.
- [ ] Produce one EN/pt-BR switchable presentation from shared content, verified date and current implemented/planned labels, covering 20–30 minutes with hands-on separately paced.
- [ ] Finalize the self-sufficient checklist, Bruno facts/unknowns, five-criterion 0–2/N/O scorecard and offline portable folder/ZIP; verify links and startup/fallback instructions.
- [ ] Report language switching, narration-versus-state inaccuracies and allocation/load limitations; fix bounded scenario blockers or explicitly present their disposition for review. Later study-method work is not a new prerequisite.
- [ ] Return evidence to #9 for the readiness review; do not merge #8 or select a foundation implementation.

Related: #6, #7, #12, #14, #36. Keep the authored-activity exploration separate and later.


## Current next action

Coordinator: `d4vidz`; In progress. The agent-operated real Luna browser loop now completes through near-only write. Review the linked replay/results, verify the remaining browser archive control and human UX observations, then finalize the presentation/checklist/package. PR readiness and merge remain separate.

## Readiness round — 16 November 2026

One actual user-operated Luna browser attempt observed context, native question/answer and two drafts; Monday additions0 and no observed conflicts. It was archived with both sectionspending and no decisions/writes. The facilitator clarified they replied in chat only, so this is an approval-handoff UX finding, not a provider-write failure. The current UI (`65c304d`) adds weekly calendar/proposal overlays, safe message formatting, collapsed activity and explicit stable section approval controls; DOM checks pass. The facilitator confirmed “Calendar visible; layout is clearer.” One explicit near-only live approval remains pending, as do recording/replay and final bilingual package. Browser-control connector is unavailable. [Current report](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/756b16a/docs/review/readiness-2026-11-16.md) / [launch guide](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/756b16a/docs/host-luna-preview.md). No real-data or remote-control exposure.


### Limited visual confirmation — 16 November 2026

The facilitator reported: “Calendar visible; layout is clearer.” This confirms visibility and improved layout/approval handoff only. It does not establish a successful live write, pick-one/multi-select question-widget parity, accessibility compliance or a recording. Keep #40 open; next required live check remains explicit Coming week approval with future pending.

## Structured question follow-up — 17 November 2026

Coordinator remains `d4vidz`; Project **In progress**. The companion now supports the native answer contract: pick one, pick several with optional text, type an alternative/standalone answer, and dismiss. Option descriptions are visible; polls and EN/pt-BR switching preserve drafts. An answer remains clarification, never calendar approval.

- [x] QW1–QW7 companion implementation and automated DOM/native-protocol checks: blank/overlong validation, exact selections/custom text, stale forms, duplicate prevention and zero approval calls.
- [ ] Actual-browser verification of the new controls and accessibility; earlier calendar visibility feedback is not this check.
- [ ] Explicit near-only Luna browser write and observed resulting events, with future pending; then recording/replay and final package.

The existing idle Bruno run `d2ba3486-3a79-4b33-864c-f24adab60ea5` lost Calendarpit to **OOMKilled=true / exit 137** at the configured 512 MiB cap after about 61 minutes. Both sections were pending, no write claims existed and calendar contents were unavailable. Private synthetic evidence was preserved; trusted archival recorded unavailable/null events and verified old container/network absent. No simulator was restarted under that identity and no approval was reused. Runtime follow-up is recorded in #11; a memory fix/long-session reliability is not established.

**Next action:** use a fresh Bruno fixture shortly before the local exercise, inspect question widgets, make the Monday correction, click only **Approve coming week**, verify events and future pending. Leave failures open for inspection. Browser control remains unavailable to the agent. All 157 offline checks pass on code `39cfc810`; full source/evidence and limitations: [report](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/8003e6b7aec7734155ea1dc6a694dc5580acf122/docs/review/question-widgets-2026-11-17.md), [shared bilingual question contract](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/8003e6b7aec7734155ea1dc6a694dc5580acf122/docs/question-widget-contract.md), [local checklist](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/8003e6b7aec7734155ea1dc6a694dc5580acf122/docs/host-luna-preview.md). No new generative or paid call occurred in this follow-up. PR #8 remains draft; #44 selection stays separate.

## Phone-preview error — 17 November 2026

The facilitator confirmed the screenshot came from a **phone preview of localhost :4176**, not the archived read-only Tailscale page. A regression reproduces the exact `Unexpected end of JSON input` when an API response is empty. Direct localhost status is healthy; wrong-origin controls return403 before mutation. The precise forwarding behavior inside the phone preview is unobserved.

Fix `734658b6` replaces parser/network errors with EN/pt-BR explanations, explicitly marks an unconfirmed mutation without retrying it, and adds persistent direct-local-browser guidance. Initial control buttons stay disabled until status loads. **158 offline tests pass**, including empty405/200, HTML502, JSON403 and network rejection. [Report/evidence](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/734658b648e0f20f8d2793f9d265cb010bcd3077/docs/review/question-widgets-2026-11-17.md#phone-preview-follow-up--prévia-no-celular). Running assets are updated; no server restart, run start, model or calendar write was needed.

**Next action:** use a direct browser on the development computer at http://127.0.0.1:4176/ for the pending Bruno question/correction/near-only approval walkthrough. Phone preview is not a supported control path. http://100.120.7.46:4178/ remains an archived read-only example. Actual post-fix phone inspection remains unobserved. No access checks were relaxed; remote-control authorization, final package and #8 merge gates remain separate. Coordinator/status unchanged: `d4vidz`, In progress.


## Real Luna browser result — 17 November 2026

**Met by an agent-operated actual UI run:** Luna context read → native radio question/answer → proposal → Monday correction → separately clicked near-only approval → independent resulting-calendar verification. Run `6b1f6bb9-6fe9-44eb-b257-4ea7d3ca2417`, source `734658b6`. Exactly five near IDs were added; all 146 existing events unchanged, no future events created, future pending and no unresolved claim. This is prepared synthetic data/answers, not human UX review. Radio selection survived EN/pt-BR switching; other answer modes remain offline-only evidence.

**Preserved findings:** initial near 4h/1h and horizon 20h/10h were called balanced; revised horizon 19h/11h remains skewed (#42). A stale Applying button and wrong approval-location wording were reproduced/fixed in `667dcbb5`, with 158 offline tests passing. No second live write of that UI patch is claimed. Agent-output/notice language is imperfect. The browser archive interaction timed out; preserved evidence and trusted HTTP retirement verified a 151-event archive and resource absence. Browser archival remains unverified.

**Artifact:** [bilingual actual-screenshot replay](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/b5f0baf1395e080d17f3303b3100e5261aeb866e/docs/evidence/luna-browser-2026-11-17/replay.html), [report/JSON](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/b5f0baf1395e080d17f3303b3100e5261aeb866e/docs/review/luna-browser-walkthrough-2026-11-17.md); phone-readable temporary replay at http://100.120.7.46:4178/walkthrough/replay.html (read-only). No continuous recording capability was exposed; this is explicitly a screenshot replay. It rendered and its navigation logic/image files passed a local check; the facilitator subsequently confirmed phone Next navigation from 1/5 to 2/5; earlier click automation stopped responding. The final switchable onboarding presentation/package and human scorecard remain incomplete. Long-session simulator OOM remains #11, not fixed by this short run.

Next: review the real evidence and remaining UX/package checks; preserve #8 draft and explicit merge/foundation gates. The near-only browser-write gap is no longer pending. No paid-provider call or branch integration occurred.


### Human phone check — 17 November 2026

The facilitator answered **“Yes, Next advances”** for the read-only replay counter 1/5 → 2/5 on a phone. This limited second-device navigation check is now observed. It does not establish all five steps, bilingual/accessibility parity or human assessment of Luna's workflow. Preserve the earlier automation failure separately; browser archival remains unverified. Next: final presentation/package and remaining archive/human UX checks. Owner/status unchanged (`d4vidz`, In progress). [Updated evidence](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/8447712cdbd815f2a556317cffdb7fa53aa4931b/docs/review/luna-browser-walkthrough-2026-11-17.md).
