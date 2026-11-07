# Synthetic Calendarpit provider API spike

`src/foundation/calendarpit-api.mjs` is a standalone client, not yet wired to the prototype or the authoritative domain service. It calls only `/calendar/v3` on a loopback Calendarpit origin and uses an injected synthetic OAuth bearer token. The caller must obtain that token from Calendarpit's synthetic OAuth flow; real Google credentials and accounts are outside this spike.

The client supports one page of `events.list`, `events.get`, `freeBusy` and event insert, patch and delete. Follow the returned `nextPageToken` for all event pages. Do not mistake a successful free-busy HTTP status for all-calendar success: inspect each calendar's errors. Recurrence, pagination, partial results and provider behavior require further end-to-end testing.

Writes require an injected trusted `authorizeWrite(action, approval)` callback that returns `true` only after checking the exact action and approved revision against authoritative state. It receives the event/changes, IDs and observed ETag where applicable. The caller must implement and persist this authority; a callback returning `true` by default is not an approval system. Changes are copied before verification to prevent caller/verifier mutation from changing the sent payload. Create requires a stable event ID; patch and delete require a specific ETag, sent with `If-Match`, with `412` propagated as a stale condition. Insert has no equivalent event ETag; recheck availability before approved creation and reconcile conflicts/partial writes at the domain-service layer.

The bearer token is stored in a private field and HTTP errors omit response bodies, but the caller still owns its secure storage. This is a synthetic-only local adapter, not proof of isolation from another process with access to the local emulator, and not a replacement for real-provider integration tests. Network errors and authentication expiry require caller handling; no automatic retries are performed.

The opt-in Docker test exercises synthetic OAuth, v3 reads/free-busy, verifier-approved create/patch/delete and a stale ETag response. On 2026-11-06 it passed on the development host together with four mocked checks:

```sh
CALENDARPIT_LIVE_TEST=1 node --test --test-isolation=none tests/calendarpit-api.test.mjs tests/calendarpit-api.integration.mjs
```
