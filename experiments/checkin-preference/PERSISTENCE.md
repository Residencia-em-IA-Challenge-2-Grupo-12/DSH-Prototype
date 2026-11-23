# Recovering a reviewed preference

The synthetic experiment stores its checkpoint in the selected run’s existing SQLite database. A confirmed preference records its origin, date limits, strength, allowed fallback, confirmation time and any confirmed version it supersedes. Its applied preview names the exact version. Pending interpretations have their own IDs. Free-text check-ins stay in the private test run so the confirmation screen can show the user’s original words after a restart. The browser conversation itself is reconstructed as a restoration notice.

## Observed in Chrome

On 23 November 2026, at source commit `38a749805a561ea41f7603cd4843ef837c867e75`, the trusted lifecycle controller kept one synthetic run registered while two companion processes were killed and replaced. The browser reloaded after each replacement. Scripted replies supplied the same interpretations to both the in-memory and pinned Calendarpit runs.

| State | Preview | What persisted |
| --- | --- | --- |
| First confirmation, Nov 2–8 | 3 h total, 0 h Friday | The confirmed restriction and its confirmation time |
| First restart with a conflict pending | 3 h total, 0 h Friday | The same preview ID, source replies and confirmed version, with a separate pending draft |
| Explicit confirmation of the replacement | 4 h total, 1 h Friday | New preview and confirmed version, linked to the earlier decision |
| Second restart, after expiry | 4 h total, 2 h Friday | The expired decision stayed visible. The new preview had no applied preference ID. |

The browser's stale confirmation and attempted calendar approval were rejected. The same 108 Calendarpit events were observed before and after the test. The controller verified retirement, exported the standard recovery archive without check-in text, and removed the private run directory. Offline regressions verified that a changed calendar blocks restoration and preserves the saved review, and that a Friday block is governed only by a preference whose date range includes that Friday.

- [Restored planning review](evidence/restart/restored-review.png) · [Expired review](evidence/restart/expired-review.png)
- [Pinned Calendarpit result](evidence/restart/calendarpit.json) · [Scripted fixture result](evidence/restart/scripted.json)

## Scope for review

This trial restarts the companion process. The trusted controller and simulator stay running and the child receives only read-only synthetic observations. Recovery of an interrupted provider write or a dead controller stays subject to the existing lifecycle safeguards. The tested implementation keeps preferences within a single synthetic run. Carrying a preference to a different run, retaining source notes beyond retirement, and the controls for reviewing or deleting those records are separate product decisions.

The next review can use the recovered screen to see whether a person understands which preference is active, what confirmation will replace it, and what expiry means. The scripted browser run verifies the state and controls. It provides no independent user-comprehension observation.

## Reproduce

```sh
node experiments/checkin-preference/restart-browser.mjs --scripted /tmp/checkin-restart-scripted
node experiments/checkin-preference/restart-browser.mjs --calendarpit /tmp/checkin-restart-calendarpit
```

Use the pinned Node, a fresh output path, and Chrome. The Calendarpit variant needs a local Docker daemon and the pinned image. Both variants run without model credentials.
