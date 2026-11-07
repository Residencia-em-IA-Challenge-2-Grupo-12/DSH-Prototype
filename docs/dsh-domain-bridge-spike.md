# Native DSH read-side bridge feasibility

This synthetic-only experiment uses the pinned DSH client Remote and host gateway with the loopback SQLite domain-service spike. `calendarSpike/read` reads a configured fictional student's current calendar observation and one proposal; it refuses unknown students, checks source revisions before and after reads, and flags a stale proposal. It exports no write or approval methods. No model call or browser automation is involved.

Two integration tests start a real local domain HTTP service, create synthetic records and test the installed DSH gateway. One invokes the host's SRC fallback directly. The other uses a **hand-authored strict descriptor**, mounts it with the real `ctx.remote.$mount`, and sends a client Remote call through an in-process test carrier to the real host gateway. Invalid typed arguments, non-owner access, unknown students and an unavailable write method are rejected. The strict schema covers the wrapper fields; the calendar and proposal payload contracts remain generic. The production descriptor should come from a supported Typert generation/build workflow; this manual experiment is tied to the pinned DSH version.

Run from the repository root with its pinned Node executable. This draft depends on the domain-service and domain-store modules from the domain-service branch:

```
./node_modules/.bin/node --test --test-isolation=none tests/dsh-domain-bridge.test.mjs tests/dsh-domain-strict-client.test.mjs
```

This does **not** establish a working browser sidebar. The carrier is a minimal in-process test adapter, not the authenticated browser carrier. The client plugin, browser descriptor bundle, rendering, review buttons, recovery and restart behavior have not been tested. The local domain service is unauthenticated: another local process can create approvals. Do not expose it to the agent or use real data. Owner peers bypass RemoteAccess decisions; the static host allowlist is essential and is not an identity system. Source-version changes racing just after the final read are still possible.

`stale: false` means only that the three source revisions matched at the final check. It does not report whether a section was approved, rejected or already applied, and it is not eligibility or authorization to write. A later action must check the durable decision and current revisions again.

A fair interface comparison still requires a maintainable client descriptor/contribution, actual mounted DSH UI, the same domain/workflow used by the SDK application, client-to-host trust, question/revision/approval paths, stale and partial states, localization and matched user tasks. Do not select a product shell based on this host/client transport check.
