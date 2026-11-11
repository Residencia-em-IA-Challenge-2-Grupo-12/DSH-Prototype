# Disposable-run implementation in progress

This draft branch builds on recovery PR #37. It is synthetic-only and must not be used as a completed disposable application or merged as one yet.

The initial commit carries forward the standalone Calendarpit runner from `feat/calendarpit-run-lifecycle` (#18) and the Google-compatible client from `feat/calendarpit-provider-api` (#21), together with their existing unit and opt-in Docker integration tests. On the development host the tests verified synthetic OAuth, provider reads and ETag-protected writes, independent simulator instances and cleanup. They do not verify the application workflow.

Neither component is connected to the companion or DSH. The runner publishes an unauthenticated administration endpoint on host loopback and its Docker network permits egress; it does not isolate or retire an agent, persist run identity, survive a hard kill cleanly or archive evidence. The client delegates approval to its caller and is not itself an authority. Before exposing a runnable environment, integrate the journal and provider client, restrict the actual agent tool catalog and network, implement and verify retirement and archival, and package the trusted application and DSH in containers. Fail closed and report scope if these guarantees require the broader execution-worker architecture.
