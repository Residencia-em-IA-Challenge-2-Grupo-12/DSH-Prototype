# Experimental OpenRouter environment

The OpenRouter key belongs in a private host file, outside this repository and outside disposable study runs. On the development machine the default is `~/.config/study-atlas/openrouter.env`:

```dotenv
OPENROUTER_API_KEY=your-key-here
```

Edit the file locally; do not put an actual key in chat, fixtures, Git, reports or this example. The directory should be private (`chmod 700 ~/.config/study-atlas`) and the file readable only by its owner (`chmod 600 ~/.config/study-atlas/openrouter.env`). The Docker user running the gateway must be able to read that file. To use a different location, set `STUDY_OPENROUTER_ENV_FILE` to the absolute path before starting Compose.

The experimental `model-gateway` Compose profile mounts that file read-only as a Docker Compose secret, only into the trusted gateway. It does not put its value in the container environment. Normal container recreation and ordinary `docker compose down` preserve both the host file and the separate named budget volume. Recreate the gateway after changing the file so it reads the new value. Docker administrators and the host file owner can still access the file; this is not a defense against a privileged host user.

**Current limitation:** this service is not connected to the application or DSH. Its network is internal and its pricing is deliberately unset, so it cannot make live model calls. This is a tested persistence and isolation building block, not a working OpenRouter setup yet. The default Luna route is unchanged. Do not use paid calls until the DSH integration, official-provider pin, verified pricing and shared budget checks are complete.

The local ledger is an approximate $5 target, not a provider-enforced cap. It must survive across the comparison: `docker compose down --volumes`, deleting its volume, changing the Compose project name or moving the ledger creates a fresh ledger and loses local spending history. Restore or account for prior spending before any further paid request. Other use of the key, provider charges and delayed usage can exceed the local estimate.

The synthetic Docker persistence test uses a temporary fake key and removes only its own uniquely named test project and volumes:

```sh
STUDY_DOCKER_TEST=1 ./node_modules/.bin/node --test tests/gateway-docker.integration.mjs
```
