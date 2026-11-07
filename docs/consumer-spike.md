# Synthetic shared-service consumer spike

This is a small **deterministic, synthetic-only host experiment**, not a DSH session, deployed application or trust boundary. It reads Ana's fictional profile, observes the isolated simulated calendar through the provider API, creates an immutable proposal for one heuristic block, and exposes separate read/draft and review/application interfaces. The `human` interface stays with the trusted host; its JavaScript object separation is not authentication or security isolation.

The review surface requires the exact `APPROVE` token to apply one synthetic event; any other response rejects it. The provider bridge rechecks the calendar and records a durable claim and actual outcome. Pending, unknown and review states require manual investigation; no reconciliation API or UI exists. The domain service is unauthenticated. Never expose it or the provider credentials to an agent, another user, a network, or real data. Calendarpit cannot atomically precondition a create on calendar-wide availability; observed races are flagged where possible.

Run offline tests with the pinned Node runtime:

```sh
node --test --test-isolation=none tests/sdk-app-consumer.test.mjs tests/calendar-domain-observer.test.mjs tests/calendar-approved-create.test.mjs
```

Run live simulator integration with Docker available:

```sh
CALENDARPIT_LIVE_TEST=1 node --test --test-isolation=none tests/calendar-experiment.integration.mjs
```

For a local human walkthrough, use an interactive terminal:

```sh
node scripts/consumer-spike.mjs
```

The script starts a disposable pinned Calendarpit instance and a loopback domain service. It displays the selected course sources, current events, the one proposed event and its assumptions before accepting a review decision. It saves a synthetic checkpoint and SQLite state under a newly created private temporary directory. It attempts to remove the simulator after a rejection or settled outcome. If the state is uncertain, it retains the simulator and reports the synthetic run and artifact location for investigation. Container/process failures can still require manual cleanup. Temporary artifacts contain fictional calendar data and must not be populated with credentials.

Validated on 2026-11-07: 27 offline tests passed, both live integration cases passed, and separate interactive terminal runs rejected and approved the proposal respectively. These tests used synthetic Calendarpit OAuth; they did not exercise DSH, another user-facing shell, multilingual parity, source-text reasoning, multiple events or real Google APIs.
