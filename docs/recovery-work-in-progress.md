# Baseline recovery work in progress

**Do not merge this intermediate branch as a completed recovery fix.** It is a synthetic-only development slice for issue #36, based on PR #8. It does not yet protect calendar applications from ambiguous outcomes or coordinate every state writer.

The first slice adds a local SQLite state store and transactional checkpoint/feedback updates. Legacy per-student synthetic JSON is imported on first read and left unchanged as a backup. The cross-process checkpoint/feedback regression and legacy-import check pass. Other paths still use full-state replacement and can race; further work must route every mutation through the same authority, add durable application claims and reviewed reconciliation, update the UI and verify all original failures before this can be reviewed as a fix.

Node's built-in SQLite interface is experimental. The database requires a local filesystem with working SQLite locking; this initial slice is not a cross-container deployment or authentication boundary. Continue to use fictional data only.
