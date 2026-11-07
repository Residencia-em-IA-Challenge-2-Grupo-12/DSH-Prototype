# Native DSH synthetic calendar panel experiment

This read-only experiment packages a proportional week view as a DSH sidebar plugin. A hand-authored strict Remote descriptor connects its client to a host endpoint; the host reads one configured synthetic student's current calendar revision and proposal from the local domain service. The host exposes only `calendarSpike/view`; it provides no approval, calendar write or workspace tool. The component shows a stale notice if the proposal's context, evidence or calendar versions no longer match. It consumes the shared consumer's single-create `sections.near.action` proposal, rejects unsupported proposal shapes, and displays a notice that it only shows same-day timed events and that overlaps may cover one another.

## Reproduce the programmatic carrier check

This branch requires the domain service/store and DSH dependencies from the domain-service draft. Use Node 24 and esbuild 0.25.5 in a dedicated temporary build environment:

```sh
npm install --prefix /tmp/study-panel-build esbuild@0.25.5 --no-audit --no-fund
ESBUILD_BIN=/tmp/study-panel-build/node_modules/.bin/esbuild node experiments/dsh-native-panel/build.mjs
node --test --test-isolation=none experiments/dsh-native-panel/{host,panel-view,process-cleanup}.test.mjs
node experiments/dsh-native-panel/carrier-test.mjs
```

The test creates an isolated temporary DSH home, starts the domain service and DSH Web bound to `127.0.0.1`, seeds fictional records, and terminates both services. It uses a temporary, newly generated DSH web token solely in the test process to obtain a session cookie; neither is printed or persisted outside that temporary home. It sends no model requests and reads no user credentials. A hard-killed test could leave child processes or temporary files; inspect them before reusing the environment.

On 2026-11-07 the equivalent test passed: the actual DSH authenticated index included the plugin boot row; the built client bundle was served; an authenticated HTTP Remote call returned the synthetic calendar and proposal; a changed context surfaced a stale flag; unauthenticated calls returned 401; and unexported read/approval methods returned 404. Eight unit checks also cover revision and record validation, the shared proposal format, fixture timestamp placement, unsupported schemas, and confirmed child exit with bounded SIGTERM/SIGKILL escalation. A non-stale result is a point-in-time revision comparison, not approval, availability or authorization to write. This verifies package serving and the real host/carrier endpoint, not execution of the client in a browser.

## Limits

- **Actual sidebar mounting, browser execution, visual rendering and user interaction remain unverified:** no browser surface was available. A bundled script appearing in the boot graph is not evidence that its React component mounted successfully.
- The descriptor is hand-authored against DSH 0.2.2-rc.1; the pinned Typert generator is publicly available, but its standalone source-workspace build was not established. The result schema covers outer fields; nested proposal/calendar payloads remain generic.
- The domain service has no authentication. DSH web authentication is not a substitute for isolating the service from agent Bash or arbitrary local processes. The host and its plugin run with host authority; the agent sandbox and trusted review/write service are not wired here. Synthetic data only.
- The panel currently targets Ana and the fixed week 2–8 November 2026. Time parsing assumes its synthetic São Paulo timestamps and omits multi-day/all-day handling and overlap layout. It has no question, revision, approval, write, live refresh, recovery or partial-state UI.
- This is not a matched user-workflow comparison with the SDK app and does not justify selecting a shell. The future comparison must use the same domain records, rendering rules, questions, revision/review, stale/partial states and bilingual workflows in both implementations.
