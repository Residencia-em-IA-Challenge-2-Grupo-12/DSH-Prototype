# DSH native calendar sidebar spike

This experimental DSH 0.2.2-rc.1 client package illustrates a proportional week grid and proposal difference in a native session sidebar. It uses hard-coded **synthetic illustrative data**, has no credentials and performs no calendar writes. The DSH host activated its entry in an isolated startup, but browser activation and a user evaluation have not been verified. This is not the shared product calendar renderer.

The package follows the installed DSH sidebar registrations and browser module loader. One test uses mock DSH interfaces; another uses the installed DSH registry to resolve package metadata and the browser entry. Neither proves browser rendering, localization or lifecycle integration end-to-end. The common domain service and host/Remote connection do not yet exist. A fair shell comparison requires both candidates to consume the same real synthetic domain contract, question, revision, approvals, stale/partial-state handling and localization. Do not use this spike for a product decision before those checks.

Run the offline structure test from the repository root:

```sh
node --test tests/dsh-calendar-sidebar.test.mjs
```

The host-side Remote feasibility check can be run from the repository root with `node --test tests/dsh-remote-gateway.test.mjs`. It invokes the installed gateway in-process and checks a synthetic read and several denials. It uses source-mode fallback rather than generated strict descriptors; the generator and a client-to-host transport have not been verified. Owner principals bypass RemoteAccess policy, so a real backend must enforce its own write and review authority.
