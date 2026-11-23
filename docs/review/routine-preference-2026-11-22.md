# One evening preference · Results · 22 November 2026

The form rule matched the frozen decision in five of five cases. GPT-6 Luna matched it in three of five. Both saw the same validated candidates. The form rule received the structured preference. Luna received the equivalent dated plain-language statement and an opaque case ID in the packet. [Frozen cases and method](../../experiments/routine-preference/README.md).

| Case | Form rule | Luna | Judgment |
| --- | --- | --- | --- |
| Wednesday can stay free at no cost | Recommend 4 h, Wednesday free | Same | Correct timing, preference and course totals |
| No fallback agreed, one fewer weekend slot | Ask, 3 h with Wednesday free or 4 h with 1 h Wednesday | Recommended 4 h with 1 h Wednesday | Accurately described both schedules and made the choice before Bruno had authorized the fallback |
| One Wednesday hour explicitly allowed | Recommend 4 h with 1 h Wednesday | Same | Tied the recommendation to the explicit permission |
| Wednesday is unavailable | Recommend the feasible 3 h, Wednesday free | Same | Explained the hard limit and one-hour shortfall |
| The previous preference expired | Recommend 4 h under the current inputs | Asked, 3 h with Wednesday free or 4 h with 1 h Wednesday | Recognized the expiry and absence of newer feedback, then reopened the choice anyway |

Every reply was valid JSON. The assistant’s stated totals and constraints matched the packet in all five cases. The two missed actions concern who should choose and when a preference still applies. Two replies used Portuguese for English packets. Language was outside the frozen scoring rubric.

## Evidence and scope

Five fresh browser sessions used the existing host fallback with DSH 0.2.2-rc.1 and the Codex GPT-6 Luna route at experiment commit 6e346fc56aefb45feb7e0ea78f3bc28671453533. The exact packets, form choices, raw responses, trace hashes and run IDs are saved below. There were zero tool calls or native question widgets in the five captures. The Sunday change in some packets was a hypothetical input to candidate generation. Each simulator retained its 146 original events and retired. One model response was captured per case. Reply times ranged from 4.4 to 9.7 seconds including browser submission and polling. Usage was unavailable. [Machine-readable evidence](../evidence/routine-preference-2026-11-22/result.json).

The form simulation assumes the user or another process has normalized the preference. The cases assess the recommendation decision after checked candidates exist, with one fixture family and one run per case. Human interaction effort, native widget operation and changes to well-being remain unobserved.

## Next review

Keep the inspectable rule as the reference for when a tradeoff needs a question. Test a small application step that takes a reviewed preference with a scope and optional fallback and exposes the resulting decision and candidates to the agent for an explanation. The model can help interpret the user’s words and phrase the question, and the rule can take account of whether it has a current reviewed preference and permission to relax it. Use fresh cases to test an unresolved fallback, explicit permission and expiry, then inspect the actual widget. Preserve the baseline outcomes before adjusting guidance.

Once that works across a new case, #5/#14 can exercise one optional check-in and a visible preference change across two revisions. #45 remains the separate heuristic-versus-CP-SAT comparison.
