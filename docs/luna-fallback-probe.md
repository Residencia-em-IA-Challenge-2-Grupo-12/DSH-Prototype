# Host Luna fallback: bounded probe findings

**Inspected 13 November 2026.** No live model request was made and no credential values were read. This note covers the pinned subscription package 0.9.12 and DSH 0.2.2-rc.1; it does not establish live readiness.

## Supported configuration and intended instantiation

The existing `StudySession` accepts an absolute trusted `dshHome` only with `brokerSocket` and without a comparison gateway. This permits the existing persistent plugin/login to remain outside a disposable synthetic run. It does not isolate that host DSH process from its credentials or host OS. Construct the service and broker for the selected run first, stage that student's synthetic workspace, then instantiate the session under that run's `withSyntheticRuntime` context:

```js
withSyntheticRuntime(runDirectory, () => new StudySession('bruno', {
  brokerSocket: runDirectory + '/ipc/agent.sock',
  dshHome: trustedPersistentDshHome,
}));
```

The actual `start()` must also execute within the intended runtime context (or use a trusted run-scoped wrapper); constructor invocation alone does not retain AsyncLocalStorage. Runtime derives workspace and startup-marker paths at boot. Do not accept `dshHome` or the broker path from browser/model input, and do not copy the credential store into fixtures, archives or the agent container. The selected DSH profile remains `sdk`, provider `codex`, model `gpt-6-luna`; native approval requests remain rejected in favor of the separate trusted calendar approval service.

The installed plugin declares a headless provider composition and supports `providers: ['codex']` and `pool: {enabled: false}`. These can limit provider registration and account pooling without importing internal adapters. The SDK overlay must explicitly constrain every auxiliary generative route as well; the plugin's presence alone is not a Luna-only guarantee.

## Actual catalog complication

The plugin registers `image_generate` when Codex is configured. Its `toolEnabled` preference defaults to true. It can also register a Codex web-search provider when the web capability is present. The study overlay disables the web tool; however, the extra image tool is a distinct registration. Source: installed package `lib/index.js` around its `ctx.inject(['tools'])` block and `lib/provider-settings.js::toolEnabled`.

A temporary credential-free probe loaded the installed plugin by its public package entrypoint with Codex only and pools disabled, using a fresh empty DSH home. A Node preload rejected TCP/TLS connections; no initialize/prompt request was sent. The observed global tool catalog contained `ask_user_question` and `image_generate`; the study dispatch guard denied image execution. The study MCP tools did **not** register in this restricted probe, so this was not a passing complete-catalog test and does not establish the exact cause of the missing MCP tools. A separate baseline catalog test also failed in this restricted execution environment, while the fake SDK-session tests passed. Do not interpret those failures as proof that the brokered profile is broken on the actual development host.

## Narrow correction to test

Keep the global deny-by-default dispatch guard. At `agent/created`, apply an agent-local tool restriction to the fixed study allowlist before the existing pre-step catalog check. The subscription plugin itself uses the supported `agent.ctx.tools.restrict({deny})` hook to hide optional tools for a session; our policy can use that same public seam to remove unrelated tools rather than changing the user's stored preferences. Continue checking the exact catalog and broker readiness before every step so later unexpected registration fails closed. This is a proposed correction, not a verified implementation.

## Runnable non-model checks

The existing fake-harness tests verify the persistent-profile wiring and model selection without login or a provider call:

```sh
./node_modules/.bin/node --test --import ./tests/isolate-runtime.mjs tests/sdk-session.test.mjs
```

The existing actual DSH catalog test boots an empty temporary profile and does not prompt a model:

```sh
./node_modules/.bin/node --test tests/dsh-catalog.integration.test.mjs
```

For a plugin-loaded catalog check, use an empty temporary DSH home, insert `llm-subscriptions` from the installed package's public entrypoint with `providers: [codex]` and pooling disabled, add the existing catalog-audit fixture, and block outbound network. Do not reuse the persistent credential home for this first check. Temporary exploratory files are `/tmp/study-probe-catalog.mjs`, `/tmp/study-subscription-catalog.patch.yml` and `/tmp/study-no-network.cjs`; they are not repository test fixtures and their Node interception is a test control, not an OS security boundary.

Before a live fallback run, test the corrected policy with the actual installed plugin, broker and staged workspace; verify only the eight approved tools are model-visible, native/extra tools are denied, no provider/model fallback can occur, and the existing login works without copying credentials. The fake tests and historical host success do not satisfy that acceptance gate.

Public package documentation: [subscription plugin](https://github.com/V1ki/dsh-plugin-subscriptions) and [DSH LLM seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm/README.md).
