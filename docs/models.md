# Model setup

The demo's deterministic planner and offline tests need no model. DSH uses its own isolated profile in `.runtime/dsh`, with settings and provider credentials managed by DSH or its plugins. Never copy credentials into the repository or fixture files.

The requested [dsh-plugin-subscriptions](https://github.com/V1ki/dsh-plugin-subscriptions) package version 0.9.12 can be installed with `npm run install:codex-plugin` (stop DSH first). It was installed in the isolated web profile with install lifecycle scripts disabled. Its UI exposes **Settings → Subscriptions → Codex (ChatGPT) → Log in**. The user must complete the provider authorization and review consent. The plugin stores its own OAuth credential in the isolated DSH profile and calls ChatGPT's Codex endpoints; it is a third-party integration, not an official OpenAI plugin. Compatibility with the pinned DSH release and actual model access must be checked with a live synthetic-only run after sign-in.

The separately documented [OpenAI Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source) and [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) have their own integration and eligibility requirements. Using app-server may introduce Codex's own agent loop, so record whether a comparison tests a DSH model route or a complete Codex agent.

DSH also supports API-key and OpenAI-compatible self-hosted provider routes through its model settings. Configure a chosen provider and model explicitly; no model name or paid API request is assumed. Run only synthetic data through a live provider and record the model, harness, configuration and usage for comparisons. OpenRouter use is deferred pending the user's decision.
