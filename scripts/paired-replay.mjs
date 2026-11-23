import { open } from 'node:fs/promises';
import { packBundle, readBundle } from '../src/paired-replay/bundle.mjs';
import { runDshReplay, scenarios } from '../src/paired-replay/dsh-runner.mjs';
import { createHttpRunnerAdapter } from '../src/paired-replay/http-adapter.mjs';
import { runPortableReplay } from '../src/paired-replay/runner.mjs';

function parseRunFlags(rawArgs) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--runner-url' || arg === '--engine-name' || arg === '--mode') {
      if (i + 1 >= rawArgs.length) throw new Error(`Missing value for ${arg}`);
      flags[arg] = rawArgs[++i];
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'pack' && rest.length === 2) {
    await packBundle(rest[0], rest[1]);
    return;
  }
  if (command === 'run') {
    const { positional, flags } = parseRunFlags(rest);
    const [input, output, scenario = 'success'] = positional;
    if (positional.length >= 2 && positional.length <= 3 && scenarios.includes(scenario)) {
      const bundle = await readBundle(input);
      const file = await open(output, 'wx', 0o600);
      try {
        const saveResult = async evidence => {
          await file.writeFile(JSON.stringify(evidence, null, 2) + '\n');
          await file.sync();
        };
        const { result, failures } = flags['--runner-url']
          ? await runPortableReplay(bundle, scenario, {
              adapter: createHttpRunnerAdapter({
                url: flags['--runner-url'],
                engine: {
                  name: flags['--engine-name'] || `HTTP runner (${scenario})`,
                  mode: flags['--mode'] || 'scripted',
                },
              }),
              saveResult,
            })
          : await runDshReplay(bundle, scenario, saveResult);
        for (const error of failures) console.error(error.message);
        console.log(JSON.stringify({
          runId: result.runId,
          caseId: result.caseId,
          scenario,
          engine: result.engine.name,
          retirement: result.retirement,
          checks: Object.fromEntries(result.checks.map(check => [check.id, check.outcome])),
        }));
        if (failures.length || result.checks.some(check => check.outcome === 'fail') || result.retirement !== 'verified') {
          process.exitCode = 1;
        }
      } finally {
        await file.close();
      }
      return;
    }
  }
  throw new Error(
    `Usage: paired-replay.mjs pack <bruno|ana-held-out> <new-bundle-dir>\n` +
    `       paired-replay.mjs run <bundle-dir> <new-result.json> [${scenarios.join('|')}] [--runner-url http://127.0.0.1:PORT] [--engine-name NAME] [--mode scripted|live]`,
  );
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
