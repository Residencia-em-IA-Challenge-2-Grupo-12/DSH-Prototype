# Trusted controller container probe

On 2026-11-12 a temporary synthetic test controller ran inside the existing `study-dsh-agent:synthetic` image, with the host Docker CLI, Docker socket, host networking, host `/tmp`, and a read-only worktree mounted. It ran as the host user (UID/GID 1000) with the Docker socket group. These mounts and host networking give the trusted controller broad host authority; this is a feasibility probe, not a proposed untrusted-agent configuration or a production security boundary. The disposable agent did not receive the Docker socket.

Two isolated tests passed: the managed Ana lifecycle with separate synthetic approval and archive-before-retirement, and a drill that killed a controller **process** after Calendarpit accepted a write but before the response reached the application. A new controller process inspected the claim, observed the calendar without retry and verified retirement before replacement. Afterward no containers or networks bearing the test run label remained.

This probe reused the host network namespace and shared host paths; it did not implement the companion/controller packaging, a least-privilege Docker control service, Luna subscription support, or a restart of the controller container itself. Those remain to be tested. The test used the synthetic fake model gateway and made no paid model calls.
