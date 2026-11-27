import { createOpenAICompatibleCompleter, startSingleAgentServer } from '../src/runners/single-agent/server.mjs';

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${key}`);
      flags[key.slice(2)] = argv[++i];
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const baseUrl = flags['base-url'] || process.env.STUDY_RUNNER_BASE_URL;
  const model = flags.model || process.env.STUDY_RUNNER_MODEL;
  const apiKey = process.env.STUDY_RUNNER_API_KEY || undefined;
  const port = Number(flags.port || process.env.PORT || 4180);
  const mode = flags.mode || 'live';
  const maxSteps = Number(flags['max-steps'] || 24);
  const schemaCompat = flags['schema-compat'] || process.env.STUDY_RUNNER_SCHEMA_COMPAT || 'standard';
  const reasoningEffort = flags['reasoning-effort'] || process.env.STUDY_RUNNER_REASONING_EFFORT || undefined;
  const transport = flags.transport ?? 'loopback';
  const compose = transport === 'compose-eval';
  if (!baseUrl || !model) {
    throw new Error(
      'Usage: single-agent-runner.mjs --base-url <http://.../v1> --model <model-id> [--port 4180] [--mode live|scripted] [--schema-compat standard|gemini] [--reasoning-effort none|minimal|low|medium|high|xhigh]',
    );
  }

  const makeCompleter = key => createOpenAICompatibleCompleter({
    baseUrl,
    apiKey: key,
    reasoningEffort,
    transport,
    headers: !compose && process.env.STUDY_RUNNER_ROLE ? { 'x-study-role': process.env.STUDY_RUNNER_ROLE } : {},
  });
  const completeChat = makeCompleter(compose ? undefined : apiKey);
  const server = await startSingleAgentServer({
    host: compose ? '0.0.0.0' : '127.0.0.1',
    port,
    ...(compose ? { completeChatForRun: makeCompleter } : { completeChat }),
    transport,
    model,
    mode,
    maxSteps,
    schemaCompat,
    engineName: flags['engine-name'] || `Single-agent HTTP (${model})`,
  });
  console.log(JSON.stringify({
    ready: true,
    url: server.url,
    model,
    mode,
    schemaCompat,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }));
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
