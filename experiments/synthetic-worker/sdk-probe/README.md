# DSH SDK tool-dispatch probe

This isolated experiment registers one `synthetic_bash` tool in DSH 0.2.2-rc.1's `sdk-minimal` profile. It disables that profile's native filesystem, working-directory, persistent Bash and persistent PowerShell tool producers. The host-trusted tool plugin calls the sibling `../worker.mjs` using a fixed fictional input and a caller-selected pinned local Docker image.

Run from the project root, with `node_modules/.bin/dsh` installed. Paths are resolved relative to this directory and the project; the probe creates and destroys an isolated temporary DSH home, patch, report and synthetic host canary. It forwards no provider credentials and sends no initialize, prompt or other model request.

```bash
# Inspect the global registry and verify fail-closed behavior without an image.
python3 experiments/synthetic-worker/sdk-probe/launch.py

# Also execute the worker through DSH's actual native tool executor (Docker needed).
SYNTHETIC_WORKER_TEST_IMAGE='ubuntu@sha256:513c074113a871b51a8d16ab445c88779d6452d937a164fb5cc479f32668a41d' \
  python3 experiments/synthetic-worker/sdk-probe/launch.py
```

The live image needs the utilities and host Docker setup documented in the parent directory.

The diagnostic asserts that the **global** tool catalog contains only `synthetic_bash`; it calls the tool through `ctx.tools.execute` and checks nine native tool names return `UNKNOWN_TOOL`. With an image, the worker script checks non-root UID, absence of the Docker socket and host canary, a failed network connection attempt and access to its fictional input before returning a fictional output. A second tool-executor call sends a cancellation signal and checks that the worker reports cancellation. The separate worker live test confirms cleanup after a script has started. Without an image, the tool fails closed. Reports are private, temporary and removed when the process ends.

This is a programmatic tool-executor probe inside an SDK-profile process. It does **not** initialize an SDK session, issue a Luna request, inspect a real agent's scoped tool catalog, test dynamically loaded plugins or prove no other route can reach the host. The pinned profile still mounts host filesystem and shell backend services, and exposes SDK working-directory APIs to its trusted host. The plugin and orchestration process run on the host with Docker authority; only the invoked worker is containerized. Do not expose this SDK process to an untrusted agent or use real data on the strength of these checks.

The tool wrapper forwards the DSH tool-execution signal to the worker; the probe exercises the global executor, not cancellation from an actual agent session. In this DSH version the normalized result contains the worker's cancellation message rather than an ABORTED code. The cancellation test does not establish a fixed cleanup latency or solve daemon failure and crash recovery. Durable run ownership and recovery, agent-scoped allowlisting, producer/process isolation and a trusted authorization boundary remain integration work. The diagnostic samples the global catalog 1.5 seconds after registration rather than asserting future immutability; additions after sampling are not covered.
