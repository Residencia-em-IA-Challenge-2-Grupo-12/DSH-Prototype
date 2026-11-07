# Synthetic custom-shell sketch

A small **local-only**, deterministic web-shell sketch. It is a starting point for interface comparison, not the application or a live-model demonstration. No language model, agent process, real account, real calendar or personal files are used. The fixed simulated week and Ana fixture are synthetic; the provider is an in-memory stub and resets on exit.

The host reuses the `createSyntheticConsumer`, domain store, observation and approved-create bridge from `feat/shared-consumer-spike`. It offers a proportional week view, a single near-term proposal with source path/assumption text, and distinct approve/reject buttons. Approval changes only the in-memory provider. Existing and proposed events display in lanes and can be selected for details. This renderer supports same-day timed events in the fixed week only. Calendarpit, recurrence, all-day/multiday events, timezone changes, localization and responsive/accessibility behavior require further work.

Run from this extracted directory with Node 24:

```sh
./node_modules/.bin/node --test --test-isolation=none tests/sdk-ui-spike.test.mjs
PORT=4444 ./node_modules/.bin/node experiments/sdk-ui/server.mjs
```

Open `http://127.0.0.1:4444/` **on the development machine**. Stop with Ctrl-C. The server binds only to loopback; requests with another host, a remote address or cross-origin header are rejected. Loopback-only was selected for this comparison. A loopback HTTP smoke test verified static assets plus synthetic reject and approve behavior. Browser execution and visual rendering have not been verified; the authoring sandbox denies local network binding.

The consumer exposes an `agentSurface` containing read/draft methods only. The reviewer/controller and browser routes remain in the trusted host; no untrusted agent tools are attached. **Object separation and loopback binding are not a security boundary.** Any other local process that reaches this unauthenticated server can invoke its review endpoint. Do not expose this server, raw domain store, provider access or its review endpoint to an agent; before an agent is attached, enforce a separate review authority and a tested network/process boundary.

Five offline tests exercise the read/draft/review interface, absence of writes before approval, rejection, approved create, handler validation, uncertain-write retry blocking, and the client labels for observed-after-attempt versus stale previous snapshots. When an uncertain write has a readable resulting observation, the view displays it as a point-in-time snapshot; otherwise it explicitly marks the prior snapshot stale. Neither is a guarantee against later calendar changes. They do not prove browser rendering, authorization against hostile local processes, restart recovery, partial-write reconciliation or live Calendarpit compatibility. The existing bridge retains its local lock on an unknown outcome; the sketch has no reconciliation UI. This sketch and the native DSH transport spike use different runners and interfaces; neither constitutes a matched user study or supports a product-shell selection yet. The honest comparison still needs the same fixture, backend and end-to-end tasks, real native rendering, questions and revision, localization, recovery and separate human review.
