# Baseline recovery work in progress

**Do not merge this intermediate branch as a completed recovery fix.** It is a synthetic-only development slice for issue #36, based on PR #8. It does not yet protect calendar applications from ambiguous outcomes or coordinate every state writer.

The first slices add a local SQLite state store and transactional checkpoint, feedback, proposal draft, annotation draft, narrative and successful study-plan approval updates. Legacy per-student synthetic JSON is imported on first read and left unchanged as a backup. Cross-process checkpoint/feedback, concurrent drafting and successful approval regressions and the legacy-import check pass. An approval which finishes after a newer proposal now reports that condition and records it, but does not prevent it. Reset, failed approval and annotation application still use full-state replacement and can race; further work must route every mutation through the same authority, add durable application claims and reviewed reconciliation, update the UI and verify all original failures before this can be reviewed as a fix.

Node's built-in SQLite interface is experimental. The database requires a local filesystem with working SQLite locking; this initial slice is not a cross-container deployment or authentication boundary. Continue to use fictional data only.
