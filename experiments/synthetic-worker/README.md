# Disposable synthetic Bash worker spike

This standalone experiment runs a short Bash command against caller-supplied **fictional, flat text files**. It uses a private per-run Docker CLI configuration and an explicitly selected local Unix socket (`/var/run/docker.sock` by default; `dockerSocket` can supply another absolute socket path). It requires a trusted orchestrator with Docker access and a trusted image already present locally; neither the Docker socket nor the orchestrator's credentials are mounted into the worker. It is not connected to the application, DSH, calendar or a real workspace.

The orchestrator creates a fresh container and checks Docker-reported configuration before starting it: non-root UID/GID `65534:65534`, read-only root, `network=none`, all capabilities dropped, no-new-privileges, private/default PID and IPC namespaces, no added devices/volumes, a read-only synthetic input bind at `/workspace`, a 16 MiB `/tmp` tmpfs and an 8 MiB `/output` tmpfs. Docker inspect must report limits of 256 MiB RAM/swap, half a CPU and 64 processes; this spike has not independently measured cgroup enforcement. The orchestrator also caps combined logs at 64 KiB and applies a caller-selected 0.1–30 second script execution timeout. An optional AbortSignal interrupts in-flight Docker CLI operations; cleanup runs without that cancelled signal. A cancelled create remains ambiguous until cleanup is confirmed, and unknown cleanup is reported as an incident. Input text is limited to 1 MiB across at most 100 flat files; script text is limited to 16 KiB.

A successful script must write `/output/result.txt`. While the container is running, a bounded `docker exec` streams that single file as ustar. The host validates the tar checksum, fixed filename, regular-file type, size (at most 1 MiB) and end blocks before returning bytes. Symlinks and extra archive members fail. The finalizer attempts to remove the input directory and container after success, timeouts and output overflow. Cleanup is reported as successful only when Docker removal or confirmed absence and local deletion succeed; daemon or filesystem failures can leave resources behind. Nonzero shell exits produce `WorkerExitError` before export; captured stderr is available only as a deliberately accessed, non-enumerable property and is not included in its message or JSON representation.

## Tests

Run offline tests:

```bash
node --test --test-isolation=none experiments/synthetic-worker/worker.test.mjs experiments/synthetic-worker/bounded-process.test.mjs
```

The live test needs Docker permission and a locally available **digest-pinned, trusted** image with `/bin/bash`, `/bin/sleep`, `/bin/tar` supporting ustar, and `/bin/ln`. The image must have no declared volumes and only `PATH`, `HOME`, `LANG`, `LC_ALL` or `TERM` environment keys. Example tested on this host by the parent agent:

```bash
SYNTHETIC_WORKER_TEST_IMAGE='ubuntu@sha256:513c074113a871b51a8d16ab445c88779d6452d937a164fb5cc479f32668a41d' \
  node --test --test-isolation=none experiments/synthetic-worker/worker.test.mjs experiments/synthetic-worker/bounded-process.test.mjs
```

The offline suite also exercises cancellation of an already-running host subprocess, timeout and output bounds without Docker; this does not prove Docker daemon cleanup. The final live suite passed on the development host with that image after the private Docker config, IPC validation and cleanup changes. It covered synthetic input/output, host canary and socket absence, a network attempt, timeout, log cap, symlink rejection and cleanup. A separate live test waits for a running script, cancels it, and confirms removal of its container and input directory. Cancellation plus cleanup has no guaranteed end-to-end latency bound if the Docker daemon fails; unknown cleanup is surfaced. These tests did not independently demonstrate cgroup memory or process enforcement.

## Limits before integration

- Docker shares the host kernel and its daemon is trusted. These checks do not prove protection from kernel/container-runtime vulnerabilities or hostile image contents. Pinning identifies an image; it does not make one trustworthy or verify its supply chain. The daemon's default seccomp/AppArmor policy is not independently verified here.
- A hard kill/crash of the orchestrator or daemon can strand a container or input directory. A timed-out Docker create may finish after an absence check. Unknown cleanup writes a private incident record containing the run name and explicit socket when possible and raises an error; it never represents an ambiguous create as clean. Local input cleanup is attempted independently, and a failure is reported alongside the unknown container state, including the synthetic input path and error code when available. A durable run registry, startup reconciliation and janitor are still required.
- The keepalive requires `/bin/sleep` and automatically ends after 60 seconds. Docker exec and tar are required to remain available. Unsupported images or unexpected inspect values fail closed.
- This toy interface supports one regular output artifact, no nested input paths, no workspace writes, no file approval workflow and no integration with the agent. It is not an isolation certification or readiness claim for personal data.
- Captured worker output is returned to the trusted caller; the caller must decide what can be logged. The worker may spawn background children that change the artifact while it is being captured. Artifact contents are untrusted and capture is not an atomic snapshot; workers are killed when the container is removed.
