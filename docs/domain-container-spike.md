# Containerized domain service experiment

`compose.domain.yaml` packages the standalone SQLite domain service from the preceding draft. It is not the application stack: DSH, the simulator, the agent worker and a UI are not connected here. Use only fictional data. The service remains unauthenticated and any local process can call it; do not connect it to agent execution or personal data.

On Linux, host networking allows the service's existing strict `127.0.0.1` binding and Host/peer checks to work across the container boundary. The trusted service therefore shares the host network namespace and can initiate network connections; this is not the network-disabled worker. The image has a pinned Node 24.11.1 digest, runs as non-root with a read-only root filesystem and a named SQLite volume, and has declared resource/capability limits. The host kernel, Docker daemon and image are trusted. No claim of production-grade isolation follows from these settings.

From the repository root, run `docker compose -f compose.domain.yaml up --build`. The API listens only on `http://127.0.0.1:4176`; set `DOMAIN_PORT` to use another local port. Stop with `docker compose -f compose.domain.yaml down`. The named volume persists synthetic state; remove it with `down --volumes` only when that state is disposable.

`scripts/test-domain-container.sh` uses a uniquely named temporary Compose project and volume, tests startup and persistence across container recreation, inspects selected runtime settings, and removes only its own temporary stack and volume. It requires Docker Compose, `curl` and Node on the host. It does not test model calls, external calendar behavior, authentication, DSH, worker isolation, LAN access, or production deployment.
