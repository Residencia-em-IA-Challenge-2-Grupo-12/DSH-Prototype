import { open } from 'node:fs/promises';
import { packBundle, readBundle } from '../src/paired-replay/bundle.mjs';
import { runDshReplay, scenarios } from '../src/paired-replay/dsh-runner.mjs';

async function main(args) {
  const [command, input, output, scenario = 'success'] = args;
  if (command === 'pack' && args.length === 3) {
    await packBundle(input, output);
    return;
  }
  if (command === 'run' && args.length >= 3 && args.length <= 4 && scenarios.includes(scenario)) {
    const bundle = await readBundle(input);
    const file = await open(output, 'wx', 0o600);
    try {
      const { result, failures } = await runDshReplay(bundle, scenario, async evidence => {
        await file.writeFile(JSON.stringify(evidence, null, 2) + '\n');
        await file.sync();
      });
      for (const error of failures) console.error(error.message);
      console.log(JSON.stringify({ runId: result.runId, caseId: result.caseId, scenario, retirement: result.retirement,
        checks: Object.fromEntries(result.checks.map(check => [check.id, check.outcome])) }));
      if (failures.length || result.checks.some(check => check.outcome === 'fail') || result.retirement !== 'verified') process.exitCode = 1;
    } finally {
      await file.close();
    }
    return;
  }
  throw new Error(`Usage: paired-replay.mjs pack <bruno|ana-held-out> <new-bundle-dir>\n       paired-replay.mjs run <bundle-dir> <new-result.json> [${scenarios.join('|')}]`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
