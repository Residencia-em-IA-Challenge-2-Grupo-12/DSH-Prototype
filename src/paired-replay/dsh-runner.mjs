import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, FIXED_TODAY } from '../core.mjs';
import { createBrunoSession, draftRequest, scriptedTools } from './bruno.mjs';
import { digestBytes, verifyWorkspace } from './bundle.mjs';
import { compareObservations, runPortableReplay, scenarios } from './runner.mjs';

export { compareObservations, scenarios };

export function createDshBrunoAdapter(scenario = 'success') {
  return {
    engine: {
      name: `DSH cold-start (${scenario})`,
      mode: 'scripted',
      model: null,
      harness: null,
      tools: scriptedTools,
    },
    draftMode: 'runner',
    draftRequest,
    coldStartCase: () => 'bruno-text',
    async verifyInput(bundle) {
      const { manifest, inputSha256 } = bundle;
      const { student, clock } = manifest;
      if (manifest.id !== 'bruno' || student !== 'bruno' || manifest.locale !== 'pt-BR' ||
          clock.date !== FIXED_TODAY || clock.timezone !== 'America/Sao_Paulo' || manifest.operator.approval !== 'near') {
        throw new Error('This scripted DSH adapter supports the fixed Bruno exercise');
      }
      const authoredInput = await readFile(path.join(ROOT, 'fixtures/paired-replay/bruno/case.json'));
      if (digestBytes(authoredInput) !== inputSha256) {
        throw new Error('The authored DSH script requires the exact Bruno manifest');
      }
      await verifyWorkspace(path.join(ROOT, 'fixtures/cold-start/bruno-text'), manifest.sources);
    },
    createSession({ service }) {
      return createBrunoSession(service);
    },
  };
}

export async function runDshReplay(bundle, scenario, saveResult) {
  return runPortableReplay(bundle, scenario, {
    adapter: createDshBrunoAdapter(scenario),
    saveResult,
  });
}
