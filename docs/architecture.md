# Architecture and fixtures

```text
DSH -> stdio MCP (read calendar/files; draft; checkpoint; metrics; interpretation)
                  |
Companion UI -> local Node API -> Calendarpit management API on loopback
                  |
               .runtime JSON state and Markdown/JSON reports
```

The shared feedback contract is an array of records: `eventId`, optional `completion` (`completed`, `partial`, `not_done`, `unknown`), `actualMinutes`, `effort` (0–5), `note` and `recordedAt`. Fixtures and form submissions use the same validation. Scheduled time, user-reported activity and missing feedback are distinct.

Each reset loads `fixtures/calendars/<student>.json`, copies `fixtures/students/<student>/` into an isolated mutable runtime workspace, and loads `fixtures/feedback/<student>.json`. The in-memory Calendarpit instance holds one active student at a time. A future multi-user service needs separate instances/state and proper identity.

Study proposals contain a hash of meaningful observed calendar fields. The companion reviews near/future sections independently and checks that hash before applying. On a checkpoint or new draft, user-edited agent-owned events are marked protected. On partial failure the state records successful removals and creations and requires manual reconciliation; no automatic rollback is claimed.

Categories are simple title-based guesses unless the user approves an annotation. Labels should not be interpreted as established facts. Descriptions preserve the original text outside a short, delimited section. The report splits recent and coming weeks and labels missing feedback; overlapping events are summed and can overcount occupied time.

Future outlooks use 60-minute candidate slots within weekday 09:00–18:00. The number of weeks is capped by the requested value, nearest parsed deadline and 16 weeks. This simple deterministic policy is for demonstrations, not personalized optimization. The bundled date parser recognizes ISO and Brazilian numeric dates and assumes the synthetic São Paulo offset.

Add fixtures by following the existing JSON and directory structure, retaining only fictional data and supported Calendarpit fields. Pin image and package versions; fixed clock and fixture content must travel with the run. The tests are sequential because they share `.runtime`. Integration tests reset the running simulator.
