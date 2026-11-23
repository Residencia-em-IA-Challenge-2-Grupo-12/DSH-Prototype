# Experiment brief · One evening preference

This is the next bounded #42 experiment. It tests how a decision is presented after the same planner has generated candidates. #45 compares schedulers on its own frozen cases. The prototype leads into #5/#14, where a short optional check-in can inform the next proposal. Review and rebuild this child against #58 when its parent integrates.

## What we will do

Generate and verify hypothetical plans for the same fictional Bruno week. Give a structured form rule and GPT-6 Luna the same plans. The form has a structured preference. Luna gets the equivalent dated user statement, so we can inspect both interpretation and selection. Run the form once and capture one Luna response per case, with a fresh conversation each time. Judge the decisions against the frozen cases before changing the prompts, rule, or fixtures.

The exercise uses the existing heuristic, plus temporary candidate filters for zero or one Wednesday session. Filters are an experiment input. The candidate with one session still uses the same real agreed study windows and calendar. Each option is independently validated before it enters a packet. A hard Wednesday exclusion is part of validation and leaves a single eligible candidate. The comparison looks at decisions and language. Its outputs do not apply calendar events, update preferences or establish usability with participants.

## Five cases

| Case | Fictional situation | What we expect to see |
| --- | --- | --- |
| no-cost | Wednesday is a current preference. Four hours still fit without it. | Recommend four weekend hours. |
| needs-choice | A Sunday commitment removes one weekend hour. No fallback was agreed. | Ask one question showing three hours with Wednesday free and four hours with one Wednesday hour. |
| bounded-fallback | Bruno explicitly allows one Wednesday hour when needed to reach four. | Recommend four hours with one Wednesday hour, with the reason for the exception. |
| hard-limit | Bruno is unavailable on Wednesday. | Offer the feasible three-hour plan and explain the shortfall. |
| expired | A prior Wednesday preference ended before this week. New feedback is missing. | Recommend a four-hour plan without treating the expired preference as a current restriction. |

Case bytes and referenced profile/calendar hashes are frozen. In the ambiguous case, an unconstrained draft fills four hours with two on Wednesday. One Wednesday hour fills the same target, so the pair focuses on the smallest use of Wednesday versus keeping it free. Reviewers can flag other material changes to course coverage or weekend concentration separately.

## Run and record

With the repository’s pinned Node dependencies installed, generate a candidate packet and get the form decision. Use a new private output directory per attempt.

    out=$(mktemp -d)
    node experiments/routine-preference/experiment.mjs packet needs-choice > "$out/packet.json"
    node experiments/routine-preference/experiment.mjs control needs-choice > "$out/control.json"

For a live capture, use the installed host Luna route via the existing [local companion guide](../../docs/host-luna-preview.md). Start a fresh synthetic Bruno conversation for each case. Send only the packet with its response instructions. The packet uses an opaque case ID. Keep the descriptive case name, scorer, form output and this case table away from the model. The prompt asks for a proposed question or recommendation as JSON. Treat any tool use, failed response or incidental clarification as an observation. Record the run and model/profile, repository commit, elapsed time, available usage, and complete response. If a response is malformed, save it as evidence and count it as such. Archive and retire the synthetic run. Repeat with each case above. Keep unedited responses even when they cannot be scored.

Save a valid JSON response as response.json and run:

    node experiments/routine-preference/experiment.mjs score needs-choice "$out/response.json"

The machine check scores the action, candidate IDs and case identity. A reviewer independently inspects whether it respects the latest preference, explains the actual hours, avoids inferring health or circumstances from silence, and asks a question only when the choice remains open. For the form, assume the operator provided the normalized input and inspect whether the structured choice exposes the same tradeoff. Report any help the form would need to gather those inputs. This is a five-case decision test with prepared synthetic context. Report human effort, learning and well-being as unobserved.

The remaining workflow test under #5/#14 starts with a fictional report, asks whether to try changing next week, and checks the next revision and expiry. That is where the interface can expose the source, scope and change itself. #15 owns later decisions on participant-facing or standardized measurement.

## Review before live capture

Confirm this tradeoff rule. When a soft preference and the target conflict and Bruno has given no fallback, ask him to choose. When he has explicitly allowed the one-hour fallback, recommend it and explain why. The acceptance rules above are frozen with this interpretation.
