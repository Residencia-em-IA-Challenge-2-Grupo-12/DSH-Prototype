# Integration findings

This is a development investigation, not a security audit. Versions and observations below are specific to the tested environment.

| Component | Finding | Status |
| --- | --- | --- |
| DeepSeek Harness `0.2.2-rc.1` | Web UI, question/plan components, model routing and MCP are available. The study MCP process starts in the isolated local profile. Node >=24.9 is required. | Started; MCP protocol tested; a signed-in GPT-6 Luna run used the study tools. |
| Calendarpit `0.9.7` | Google Calendar-like API, local OAuth, fixtures and a local admin UI. The demo currently calls its unauthenticated local **management API**. | Image and reset/read/write/reconciliation tested. Google v3 and OAuth are not exercised. |
| [dsh-calendar](https://github.com/STARDUSTLC666/dsh-calendar) | Community calendar UI and tools use CalDAV; Calendarpit's v3 REST surface is not CalDAV. Google OAuth/CalDAV is mentioned by the project. | Source reviewed; not connected to the simulator. |
| [dsh-daily-kit](https://github.com/zhouwei713/dsh-daily-kit) | Includes Google Calendar and CalDAV tools; writes default off. Its documented Google endpoints point at Google, and its own documentation asks for external functional verification. | Endpoint redirection to Calendarpit is not established; not used. |
| [dsh-genui](https://github.com/omdsh-dev/dsh-genui) | Community generated UI for forms and charts. Source advertised 0.16.0, which npm had not published; 0.15.0 installed in an isolated profile with lifecycle scripts disabled, with peer dependency warnings. | Installation tested, not audited or loaded in the main profile. Companion page chosen for a stable, shared file contract. |
| [Subscriptions plugin](https://github.com/V1ki/dsh-plugin-subscriptions) `0.9.12` | Community plugin provides a separate OAuth sign-in and a `codex` model route. Source uses ChatGPT's Codex endpoints; it does not simply reuse the local Codex CLI session. | Installed in isolated DSH profile; user completed OAuth and a synthetic GPT-6 Luna request succeeded through the DSH loop. Not an official OpenAI plugin. |

[DSH plan mode](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/plan/plan-mode/README.md) is prompt guidance, not write enforcement. [User approval](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/user-approval/README.md) handles individual operations; it was not validated as a structured multi-event review. This prototype implements review in the companion interface. [Native questions](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-user-questions/README.md) provide choices and text but are not a durable activity-feedback store. DSH exposes [client slots](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.md) for a future dedicated plugin.

Other research candidates: [dsh-reference-anything](https://github.com/Chael-Chael/dsh-reference-anything) uses an OpenList service to reference cloud files; [dsh-memory-spaces](https://github.com/icearia0219/dsh-memory-spaces) provides session-oriented memory, not a calendar index. These were not installed or tested.

## Production path

Use supported Google API/OAuth clients, explicitly scoped accounts and per-user permissions. Test client endpoint overrides and use a real test account only when authorized. Add contract tests against Google for time zones, recurrence, edits, concurrency, invitations and permissions. Isolate the agent from the administrative endpoint and from raw credentials, and enforce human approval at the calendar-write boundary. Add identity, CSRF protections, authentication, per-user data isolation, secure transport and privacy policies before multi-user deployment.
