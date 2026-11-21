# Cold-start browser review

This pilot uses the existing companion as the interface for the cold-start cases in [the operator guide](cold-start-planning.md). The same logic reviews pending context, confirms a specific revision and requires separate approval for any calendar change.

1. While a native question is open, the calendar displays the concrete times the model supplied as structured options. The widget identifies overlapping commitments and disables blocked choices. Typed answers remain available. A stale selection is checked against the calendar again when the operator sends the answer.
2. Review the assessment dates, source excerpts and proposed preferences. Open the cited files from the review panel. When the agent revises the context, inspect removed or added windows and any changes to the workload or deadline evidence. Compare with the original replies.
3. Confirm the planning inputs and ask for a proposal. Review the coming week and future section independently. Each lists hours by course, including zero-hour courses. Calendar observations are checked again on approval.

The agent can ask a question without a structured time option. In that case the browser shows the question and the observed calendar without an overlay. This pilot does not attempt to infer dates from arbitrary question prose.

## Repeatable browser checks

From the repo root, with installed Node dependencies and Chrome available:

```sh
./node_modules/.bin/node tests/browser-review/scripted.mjs .runtime/browser-review
```

The script uses the real browser UI and in-process managed API. Authored conversation steps and an in-memory calendar isolate interface behavior from model variability. It covers a conflicting option, a late calendar change, the Monday revision, source inspection, zero course coverage, and stale calendar approval. It captures screenshots and a structured result. For a different Chrome executable or local test ports, set `STUDY_TEST_CHROME` or `STUDY_BROWSER_TEST_PORT`.

## Live Luna

With the existing trusted DSH profile, Docker and a separate synthetic test root:

```sh
PORT=4186 STUDY_COLD_CASE=bruno-text STUDY_RUN_ROOT=/tmp/study-review-browser \
  STUDY_LUNA_DSH_HOME=/absolute/path/to/local/dsh-profile \
  ./node_modules/.bin/node scripts/preview-luna-synthetic.mjs
```

Open `http://127.0.0.1:4186/` on the facilitator machine. The case can be `bruno`, `bruno-text`, `ana` or `ana-conflict`. The launcher fixes the case for that process. End and archive the run before switching cases or stopping the launcher. A run with unresolved ownership or writes needs inspection before reuse. The remote walkthrough shows read-only evidence. Live controls remain on loopback.

## Group check

Give the operator the prepared fictional persona card. Ask them to identify an unavailable option, locate a cited deadline, verify the revision removes the correct window, and point to any course without coverage. Ask what the input confirmation will do before they click it. Compare the same proposals across interfaces and record time, navigation, corrections and help needed. Record the model's question quality and planner allocation separately.
