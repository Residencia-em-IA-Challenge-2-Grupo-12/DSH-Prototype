# Availability questions and preference scope · 22 November 2026

The browser now retains availability options staged in multiple calls for one native question. Exact labels identify options and the browser rechecks selected windows against the live calendar before accepting the answer. Answering or dismissing the question starts a fresh group. The regression covers an earlier batch that becomes busy, an outdated preview ID and first options from the next question arriving during answer handling.

I kept the existing question widget and trusted approval flow. A larger redesign with explicit model-assigned group IDs would change the tool contract. Here the pending batches share a preview ID, which changes when another batch arrives. The English and Brazilian Portuguese course-coverage labels use the existing message catalog. The planning review shows that preferences expire on an inclusive date.

## Evidence

- **Scripted Chrome:** Bruno stages a busy Tuesday option and a clear Wednesday option in separate calls. Both appear, Tuesday stays blocked, an intervening appointment blocks Wednesday, and the later near-only approval succeeds on a fresh proposal. Ana still shows the optional 3 h / 1 h coverage alternative.
- **Live Ana:** At `dcd1036`, Luna used 15 November as the inclusive end of the two-week preference scope. The prior comparison run used 16 November. It asked about candidate windows and then asked for concrete slots within those windows. The count was two question widgets in both runs. Usefulness and repetition still require a broader observation than this pair provides.
- **Calendar:** The live run kept 4 November free, showed 11 November at 15:00–16:00 after the appointment, preserved all 108 existing events, and added only four separately approved coming-week events. The future section stayed pending. Calendarpit retirement was verified.

The live run used the established host Luna route, prepared fictional answers, and an agent operating Chrome. It took about 84 seconds with usage unavailable. [Saved observations](../evidence/question-scope-2026-11-22/summary.json) · [Inclusive scope in the review panel](../evidence/question-scope-2026-11-22/planning-inputs.png).
