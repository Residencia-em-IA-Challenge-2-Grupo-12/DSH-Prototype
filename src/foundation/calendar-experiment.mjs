import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { startCalendarpitRun, CALENDARPIT_IMAGE } from './calendarpit-runner.mjs';
import { CalendarpitApi } from './calendarpit-api.mjs';
import { authorizeSyntheticCalendar } from './synthetic-calendar-auth.mjs';
import { snapshotToReplayFixture } from '../calendar-replay.mjs';

// Key order and pretty printing do not change the checksum.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`${name} is required`);
  return value;
}

function metadata(input) {
  return {
    scenarioId: requireText(input?.scenarioId, 'scenarioId'),
    simulatedClock: requireText(input?.simulatedClock, 'simulatedClock'),
    timeZone: requireText(input?.timeZone, 'timeZone'),
    generatorVersion: requireText(input?.generatorVersion, 'generatorVersion'),
    seed: requireText(String(input?.seed ?? ''), 'seed'),
    simulatorImage: CALENDARPIT_IMAGE,
  };
}

function verifyCheckpoint(checkpoint) {
  if (checkpoint?.schemaVersion !== 1 || checkpoint.replay?.schemaVersion !== 1) {
    throw new Error('Unsupported checkpoint version');
  }
  const { sha256, ...payload } = checkpoint;
  if (hash(payload) !== sha256) throw new Error('Checkpoint integrity verification failed');
  requireText(payload.checkpointId, 'checkpointId');
  requireText(payload.lineage?.runId, 'source run ID');
  if (payload.lineage.parentCheckpointId !== null) {
    requireText(payload.lineage.parentCheckpointId, 'parent checkpoint ID');
  }
  if (!isDeepStrictEqual(payload.context, metadata(payload.context))) {
    throw new Error('Unsupported checkpoint context or simulator image');
  }
  const { fixture } = payload.replay;
  if (!isDeepStrictEqual(fixture, snapshotToReplayFixture(fixture).fixture)) {
    throw new Error('Checkpoint must contain a data-only replay fixture');
  }
  return payload;
}

// Trusted developer tooling. Administrative reads stay inside this runner.
async function start({ fixture, redirectUri, context, parentCheckpointId = null,
  runId = randomUUID(), startRun = startCalendarpitRun, fetchState = fetch,
  transport = 'loopback', allowedStudents }) {
  const info = metadata(context);
  const run = await startRun({ fixture, redirectUri, runId });
  return {
    runId: run.id,
    origin: run.origin,
    authorize(student) { return authorizeSyntheticCalendar({ run, student, redirectUri, transport, allowedStudents }); },
    provider(accessToken, authorizeWrite) {
      return new CalendarpitApi({ origin: run.origin, accessToken, authorizeWrite, transport });
    },
    async checkpoint() {
      const response = await fetchState(`${run.origin}/__calendarpit/state`, {
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Snapshot request failed (HTTP ${response.status})`);
      const replay = snapshotToReplayFixture(await response.json());
      const payload = {
        schemaVersion: 1,
        checkpointId: randomUUID(),
        lineage: { runId: run.id, parentCheckpointId },
        context: info,
        replay,
      };
      return { ...payload, sha256: hash(payload) };
    },
    close: () => run.close(),
  };
}

export function startCalendarExperiment(options) {
  return start(options);
}

export async function replayCalendarExperiment({ checkpoint, ...options }) {
  const verified = verifyCheckpoint(checkpoint);
  return start({ ...options, fixture: verified.replay.fixture, context: verified.context,
    parentCheckpointId: verified.checkpointId });
}

// Read every page, including cancelled exceptions, as their calendar owner.
export async function observeReplay(experiment, fixture) {
  const observed = [];
  for (const user of fixture.users) {
    const provider = experiment.provider(await experiment.authorize(user.id));
    for (const calendar of fixture.calendars.filter(record => record.userId === user.id)) {
      const tokens = new Set();
      let pageToken;
      do {
        const page = await provider.listEvents(calendar.id, { showDeleted: true, maxResults: 50, pageToken });
        observed.push(...page.items.map(event => ({ ...event, calendarId: calendar.id })));
        pageToken = page.nextPageToken;
        if (pageToken && tokens.has(pageToken)) throw new Error('Calendarpit repeated a page token');
        tokens.add(pageToken);
      } while (pageToken);
    }
  }
  return observed;
}
