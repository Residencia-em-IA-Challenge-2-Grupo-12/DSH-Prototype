# Domain service HTTP spike

This is a standalone experiment around the SQLite DomainStore from `feat/domain-store-spike`. It is **not connected** to the existing app, MCP server or calendar. It has no login or per-user authorization: another local process can call it. Do not expose it to a network or use real data. It binds only to `127.0.0.1`, checks Host and Origin, accepts JSON objects and caps request bodies at 64 KiB.

Use Node 24. Run tests with `node --test tests/domain-service.test.mjs`; the tests need permission to open a temporary loopback socket. Run the service with `PORT=4176 DOMAIN_DB=/absolute/path/to/state.sqlite node src/domain-service.mjs`. The default database is `domain.sqlite` in the current directory.

All paths below start with `/v1/students/{student}`. The store begins with version 0 for each revision kind; writing a revision requires its current `expectedVersion`.

| Method | Path | Request body or result |
| --- | --- | --- |
| GET | `/versions` | Current context, evidence and calendar versions |
| POST | `/revisions/{context\|evidence\|calendar}` | `{ "expectedVersion": 0, "payload": {} }` |
| GET | `/revisions/{kind}/{version}` | Historical revision |
| POST | `/proposals` | `{ "versions": {"context":1,"evidence":1,"calendar":1}, "payload": {} }` |
| GET | `/proposals/{id}` | Immutable proposal |
| POST | `/proposals/{id}/decisions` | `{ "section":"near", "choice":"approve" }` (`future` and `reject` also supported) |
| GET | `/proposals/{id}/decisions/{section}` | Recorded decision |
| GET | `/proposals/{id}/approval/{section}` | Current approved decision; 409 when absent, rejected or stale |

`GET /health` returns service status and states that provider writes are disabled. Invalid requests return 400, 413 or 415; stale versions and already-decided sections return 409. Decisions and proposal/source revisions are stored by the DomainStore. Checking approval covers current local revisions only. Actual calendar writes must separately re-read the provider and handle races and partial failure; this service performs none.

The store's JSON payloads are generic and do not yet enforce the richer student, evidence, calendar and proposal contracts from the roadmap. There are no authentication, migrations beyond schema 1, event stream, request log, lifecycle orchestrator, model invocation or sandbox integration. Browser access from other origins is rejected, so a future UI needs a same-origin proxy or a separately designed local trust boundary. Node 24 currently marks `node:sqlite` experimental.
