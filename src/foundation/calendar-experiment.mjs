import { createHash, randomUUID } from 'node:crypto';
import { startCalendarpitRun, CALENDARPIT_IMAGE } from './calendarpit-runner.mjs';
import { CalendarpitApi } from './calendarpit-api.mjs';
import { snapshotToReplayFixture } from '../calendar-replay.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function hash(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`${name} is required`);
  return value;
}
function metadata(input) {
  if (!input || typeof input !== 'object') throw new Error('Synthetic run metadata required');
  return {
    scenarioId: requireText(input.scenarioId, 'scenarioId'),
    simulatedClock: requireText(input.simulatedClock, 'simulatedClock'),
    timeZone: requireText(input.timeZone, 'timeZone'),
    generatorVersion: requireText(input.generatorVersion, 'generatorVersion'),
    seed: requireText(String(input.seed ?? ''), 'seed'),
    simulatorImage: CALENDARPIT_IMAGE,
  };
}
function verifyCheckpoint(checkpoint) {
  if (!checkpoint || checkpoint.schemaVersion !== 1 || typeof checkpoint.sha256 !== 'string') throw new Error('Unsupported checkpoint');
  const { sha256, ...payload } = checkpoint;
  if (hash(payload) !== sha256) throw new Error('Checkpoint integrity verification failed');
  if (!payload.replay?.fixture || payload.replay.fixture.clients?.length !== 0) throw new Error('Checkpoint must contain a data-only replay fixture');
  requireText(payload.checkpointId, 'checkpointId');
  return payload;
}

/** Trusted orchestrator only: management endpoints and synthetic credentials remain here. */
async function start({ fixture, redirectUri, context, parentCheckpointId = null, startRun = startCalendarpitRun, fetchState = fetch }) {
  const info = metadata(context);
  const run = await startRun({ fixture, redirectUri });
  return {
    runId: run.id,
    origin: run.origin,
    // Explicit access only: do not serialize or log this temporary synthetic client.
    syntheticCredentials() { return structuredClone(run.client); },
    provider(accessToken, authorizeWrite, fetchImpl) {
      return new CalendarpitApi({ origin: run.origin, accessToken, authorizeWrite, ...(fetchImpl ? { fetchImpl } : {}) });
    },
    async checkpoint() {
      const response = await fetchState(`${run.origin}/__calendarpit/state`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`Snapshot request failed (HTTP ${response.status})`);
      const converted = snapshotToReplayFixture(await response.json());
      const payload = {
        schemaVersion: 1,
        checkpointId: randomUUID(),
        lineage: { runId: run.id, parentCheckpointId },
        context: info,
        replay: converted,
      };
      return { ...payload, sha256: hash(payload) };
    },
    async close() { await run.close(); },
  };
}

export async function startCalendarExperiment({ fixture, redirectUri, context, startRun, fetchState }) {
  return start({ fixture, redirectUri, context, startRun, fetchState });
}
export async function replayCalendarExperiment({ checkpoint, redirectUri, startRun, fetchState }) {
  const verified = verifyCheckpoint(checkpoint);
  return start({ fixture: structuredClone(verified.replay.fixture), redirectUri, context: verified.context, parentCheckpointId: verified.checkpointId, startRun, fetchState });
}
