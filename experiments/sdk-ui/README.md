# Synthetic custom-shell sketch

A small **local-only**, deterministic web-shell sketch. It is a starting point for interface comparison, not the application or a live-model demonstration. No language model, agent process, real account, real calendar or personal files are used. The fixed simulated week and Ana fixture are synthetic; the provider is an in-memory stub and resets on exit.

The host reuses the `createSyntheticConsumer`, domain store, observation and approved-create bridge from `feat/shared-consumer-spike`. It offers a proportional week view, a single near-term proposal with source path/assumption text, and distinct approve/reject buttons. Approval changes only the in-memory provider. Existing and proposed events display in lanes and can be selected for details. This renderer displays same-day timed events in the fixed week only; it visibly notes that all-day, multiday and same-minute events are omitted. Calendarpit, recurrence, rendering of those omitted events, timezone changes, localization and responsive/accessibility behavior require further work.

Run from this extracted directory with Node 24:

```sh
./node_modules/.bin/node --test --test-isolation=none tests/sdk-ui-spike.test.mjs
PORT=4444 ./node_modules/.bin/node experiments/sdk-ui/server.mjs
```

Open `http://127.0.0.1:4444/` **on the development machine**. Stop with Ctrl-C. The server binds only to loopback; requests with another host, a remote address or cross-origin header are rejected. Loopback-only was selected for this comparison. A loopback HTTP smoke test verified static assets plus synthetic reject and approve behavior. On 2026-11-07, a desktop in-app browser displayed the week and ran a separate disposable instance through generate, reject and approve: rejection removed the preview without adding it, while approval displayed the added synthetic event. The calendar is a tall scrolling grid with small event text; this was a limited manual check, not responsive or accessibility certification.

The consumer exposes an `agentSurface` containing read/draft methods only. The reviewer/controller and browser routes remain in the trusted host; no untrusted agent tools are attached. **Object separation and loopback binding are not a security boundary.** Any other local process that reaches this unauthenticated server can invoke its review endpoint. Do not expose this server, raw domain store, provider access or its review endpoint to an agent; before an agent is attached, enforce a separate review authority and a tested network/process boundary.

Seven offline tests exercise the read/draft/review interface, absence of writes before approval, rejection, approved create, handler validation, uncertain-write retry blocking, and the client labels for observed-after-attempt versus stale previous snapshots. When an uncertain write has a readable resulting observation, the view displays it as a point-in-time snapshot; otherwise it explicitly marks the prior snapshot stale. Neither is a guarantee against later calendar changes. They do not prove browser rendering, authorization against hostile local processes, restart recovery, partial-write reconciliation or live Calendarpit compatibility. The existing bridge retains its local lock on an unknown outcome; the sketch has no reconciliation UI. This sketch and the native DSH transport spike use different runners and interfaces; neither constitutes a matched user study or supports a product-shell selection yet. The honest comparison still needs the same fixture, backend and end-to-end tasks, real native rendering, questions and revision, localization, recovery and separate human review.

## Read-only shared-domain comparison

`domain-read-server.mjs` is a separate, **read-only** route for comparing the custom calendar shell with the native DSH panel using the same `ana` calendar revision and single-create proposal. It does not use the in-memory provider or expose plan, review, approval or write endpoints. The custom view hides its action controls and shows when the proposal is stale. It rejects a domain revision changing mid-read and labels the returned calendar a point-in-time snapshot. It requires the matching calendar ID and the fixed São Paulo week, validates existing events, filters cancelled tombstones, labels tentative/free events, and fails closed on unsupported proposal keys, unrepresented event semantics or proposed blocks that cannot be shown. Explicit UTC and numeric offsets are converted to São Paulo time.

Given a running synthetic domain service and an existing proposal ID, start the comparison shell on loopback:

```sh
DOMAIN_ORIGIN=http://127.0.0.1:4176 PROPOSAL_ID=synthetic-proposal-id PORT=4444 \
  node experiments/sdk-ui/domain-read-server.mjs
```

Configure the native panel with the **same** domain origin and proposal ID. The domain service remains unauthenticated and must not be accessible to agent workers. A local process can still contact the separate domain service directly; the comparison server's GET-only routes are not a security boundary for that service. All records must be synthetic.

Offline adapter and client checks:

```sh
node --test --test-isolation=none tests/sdk-domain-view.test.mjs tests/sdk-ui-spike.test.mjs
```

The optional paired test starts an isolated domain service and custom shell, seeds fictional records, reads the same records through the actual native `PanelHost.view` method and the custom HTTP endpoint, checks matching IDs/versions/staleness, denies plan/review/write requests and verifies no decision was recorded. It also compares native and custom validation for supported and unsupported single-block shapes, calendar identities, dates and malformed events. It needs the native panel's `index.mjs` plus its `panel-view.mjs` and Node dependencies:

```sh
SHELL_COMPARISON_INTEGRATION=1 \
DSH_NATIVE_PANEL_ENTRY=/absolute/path/to/dsh-native-panel/index.mjs \
  node --test --test-isolation=none tests/sdk-native-shared-domain.integration.mjs
```

The paired local test passed on 2026-11-07, including 33 supported/unsupported event cases. CI checks against native-panel commit `ad8c020106825996c7393fc68a74552710adbbea`; update and revalidate that pin when the native contract changes. It exercises the actual native host method, not the DSH browser carrier or a mounted native sidebar; the earlier carrier test covers that separate boundary. The custom sketch received the limited desktop browser check described above. The native sidebar was separately mounted and visually checked with an existing synthetic event and a proposed event; it is still read-only and has not been assessed through matching interactive tasks. The implementations have different rendering and interaction behavior. This is a same-data transport check, **not** a fair end-to-end shell comparison or a reason to choose an interface. Conversation, revision, approvals, partial outcomes, localization and human walkthroughs remain to be compared in both shells.
