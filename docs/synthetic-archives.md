# Experimental synthetic archives

The archive component is an experimental building block. The running application does **not** yet archive runs automatically or verify that old Docker writers have stopped. It is only for the fictional Ana and Bruno scenarios.

After a trusted controller has stopped and verified every writer, it can take one transactional state snapshot and write a private archive containing the run identity, current plan structure, approval decisions and actions, write acknowledgments, protected IDs, feedback metrics and the available calendar observation. An unavailable observation is recorded as unavailable, not as an empty calendar. The archive receives an integrity hash; an identical retry is idempotent, and different evidence cannot overwrite an existing archive. A lifecycle test verifies that an archive failure blocks replacement until retry or explicit discard.

The current projection omits free text, feedback notes, conversation, raw errors, credential fields and workspace files. Event summaries, descriptions and properties are stored as hashes, so an archive **cannot reconstruct their text or support full replay**. Hashes of predictable text are not confidential. Identifiers and times are retained and must also be fictional. No real calendar data or credentials should be entered in this phase.

Before calling the archive code, the real lifecycle must prove old writers have stopped; a database snapshot alone cannot do that. It must also determine whether a simulator observation is available and preserve the unresolved claim on uncertain writes. Recovery, a user-facing summary, richer sanitized experiment bundles, snapshot replay and Docker-managed retirement remain unfinished.
