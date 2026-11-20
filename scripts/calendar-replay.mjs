import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { FIXED_TODAY } from '../src/core.mjs';
import {
  observeReplay,
  replayCalendarExperiment,
  startCalendarExperiment,
} from '../src/foundation/calendar-experiment.mjs';

const redirectUri = 'http://127.0.0.1:4175/callback';
// Compare the provider fields needed by the exercise. Also check the complete
// stored fixture below, excluding volatile observations.
const compareEventFields = ['summary', 'description', 'start', 'end',
  'status', 'recurrence', 'recurringEventId', 'originalStartTime', 'extendedProperties'];

const eventKey = event => JSON.stringify([event.calendarId, event.id]);

function compareObserved(expected, observed) {
  const found = new Map(observed.map(event => [eventKey(event), event]));
  if (observed.length !== expected.length || found.size !== expected.length) {
    throw new Error('Provider event count differs from the checkpoint');
  }
  for (const event of expected) {
    const match = found.get(eventKey(event));
    if (!match || compareEventFields.some(field =>
      event[field] !== undefined && !isDeepStrictEqual(event[field], match[field]))) {
      throw new Error('Provider event fields differ from the checkpoint');
    }
  }
}

function compareFixtures(expected, actual) {
  const ordered = fixture => ({
    ...fixture,
    users: [...fixture.users].sort((a, b) => a.id.localeCompare(b.id)),
    calendars: [...fixture.calendars].sort((a, b) => a.id.localeCompare(b.id)),
    events: [...fixture.events].sort((a, b) => eventKey(a).localeCompare(eventKey(b))),
  });
  if (!isDeepStrictEqual(ordered(expected), ordered(actual))) {
    throw new Error('Restored fixture differs from the checkpoint');
  }
}

async function main([command, input, output, ...extra]) {
  if (!input || extra.length || !['export', 'replay'].includes(command) ||
      (command === 'export' && (!['ana', 'bruno'].includes(input) || !output))) {
    throw new Error('Usage: calendar-replay.mjs export <ana|bruno> <output.json> | replay <checkpoint.json> [child.json]');
  }

  const runId = randomUUID();
  let experiment;
  let result;
  let failure;
  let source;
  try {
    if (command === 'export') {
      const fixture = JSON.parse(await readFile(new URL(`../fixtures/calendars/${input}.json`, import.meta.url), 'utf8'));
      experiment = await startCalendarExperiment({ fixture, redirectUri, runId, context: {
        scenarioId: input,
        simulatedClock: `${FIXED_TODAY}T00:00:00-03:00`,
        timeZone: fixture.calendars[0].timeZone,
        generatorVersion: 'repository-calendar-fixture-v1',
        seed: input,
      } });
    } else {
      source = JSON.parse(await readFile(input, 'utf8'));
      experiment = await replayCalendarExperiment({ checkpoint: source, redirectUri, runId });
      const observed = await observeReplay(experiment, source.replay.fixture);
      compareObserved(source.replay.fixture.events, observed);
    }

    const checkpoint = await experiment.checkpoint();
    if (source) compareFixtures(source.replay.fixture, checkpoint.replay.fixture);
    if (output) await writeFile(output, JSON.stringify(checkpoint, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    result = {
      runId,
      checkpointId: checkpoint.checkpointId,
      parentCheckpointId: checkpoint.lineage.parentCheckpointId,
      sha256: checkpoint.sha256,
      eventCount: checkpoint.replay.fixture.events.length,
    };
  } catch (error) {
    failure = error;
  }

  try {
    await experiment?.close();
  } catch {
    console.error(`Cleanup failed for synthetic run ${runId}. Inspect the calendar container and network for this run.`);
    process.exitCode = 1;
  }
  if (failure) {
    // Runner startup may report a second failure during its own cleanup.
    if (failure instanceof AggregateError) console.error(`Calendarpit startup cleanup failed for synthetic run ${runId}.`);
    throw failure;
  }
  if (!process.exitCode) console.log(JSON.stringify({ ...result, retired: true }, null, 2));
}

main(process.argv.slice(2)).catch(error => {
  // Paths, raw Docker output and request payloads may contain private data.
  console.error(error instanceof SyntaxError ? 'Checkpoint JSON is invalid'
    : error.code ? `Calendar replay failed (${error.code})`
    : error instanceof AggregateError ? 'Calendarpit startup failed'
    : error.message);
  process.exitCode = 1;
});
