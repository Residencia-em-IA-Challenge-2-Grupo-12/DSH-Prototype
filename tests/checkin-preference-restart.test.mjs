import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCheckinLoop } from '../experiments/checkin-preference/loop.mjs';
import { createCheckinStorage } from '../experiments/checkin-preference/storage.mjs';
import { createStateStore } from '../src/state-store.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/calendars/ana.json', import.meta.url))).events;

test('reopening a run restores the confirmed restriction and expiry without applying a pending replacement', async () => {
  const directory = process.env.STUDY_ATLAS_RUNTIME_DIR;
  const runId = randomUUID();
  let store = createStateStore(directory);
  await store.create('ana', { student: 'ana' });
  const open = async () => {
    const loop = createCheckinLoop({
      calendar: { events: async () => fixture },
      storage: createCheckinStorage(store, runId, 'ana'),
      interpret: async ({ previous }) => ({ kind: previous ? 'soft' : 'hard', validThrough: '2026-11-08',
        fallbackMinutes: previous ? 60 : null }),
    });
    await loop.start();
    return loop;
  };
  let loop = await open();
  const reopen = async () => {
    await store.close();
    store = createStateStore(directory);
    return open();
  };
  try {
    await loop.client.prompt('I cannot study Friday this week.');
    const initial = (await loop.service.status()).state.planningContext.pending;
    await loop.service.confirmPlanningContext(initial.id);
    await loop.client.prompt('Friday is possible after all. I accept a one-hour fallback.');
    const before = (await loop.service.status()).state;
    loop = await reopen();
    const recovered = (await loop.service.status()).state;
    assert.equal(recovered.plan.id, before.plan.id);
    assert.equal(recovered.plan.preferenceRevisionId, initial.id);
    assert.equal(recovered.plan.near.length, 3);
    assert.equal(recovered.plan.near.filter(block => block.start.dateTime.startsWith('2026-11-06')).length, 0);
    assert.equal(recovered.planningContext.confirmed.id, initial.id);
    assert.match(recovered.planningContext.confirmed.confirmedAt, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(recovered.planningContext.pending, before.planningContext.pending);
    await assert.rejects(() => loop.service.confirmPlanningContext(initial.id), /revision changed/);
    await loop.service.confirmPlanningContext(recovered.planningContext.pending.id);
    const revised = (await loop.service.status()).state;
    assert.equal(revised.plan.near.filter(block => block.start.dateTime.startsWith('2026-11-06')).length, 1);
    assert.equal(revised.planningContext.confirmed.supersedesId, initial.id);

    await loop.client.prompt('Advance the synthetic exercise to November 9');
    loop = await reopen();
    const next = (await loop.service.status()).state;
    assert.equal(next.planningContext.confirmed.id, recovered.planningContext.pending.id);
    assert.equal(next.planningContext.confirmed.expired, true);
    assert.equal(next.plan.preferenceRevisionId, null);
    assert.equal(next.plan.future.filter(block => block.start.dateTime.startsWith('2026-11-13')).length, 2);
    await assert.rejects(() => loop.service.approvePlan(), /previews only/);
  } finally {
    await store.close();
  }
});

test('a reopened check-in refuses a stale calendar and retains the saved review', async () => {
  const directory = process.env.STUDY_ATLAS_RUNTIME_DIR;
  const runId = randomUUID();
  const store = createStateStore(directory);
  await store.create('ana', { student: 'ana' });
  const open = events => createCheckinLoop({
    calendar: { events: async () => events },
    storage: createCheckinStorage(store, runId, 'ana'),
    interpret: async () => ({ kind: 'hard', validThrough: '2026-11-08', fallbackMinutes: null }),
  });
  try {
    const original = open(fixture);
    await original.start();
    await original.client.prompt('I cannot study Friday.');
    const proposed = (await original.service.status()).state.planningContext.pending;
    await original.service.confirmPlanningContext(proposed.id);
    const edited = [{ ...fixture[0], summary: 'Edited commitment' }, ...fixture.slice(1)];
    await assert.rejects(() => open(edited).start(), /saved preview no longer matches/);
    const recovered = open(fixture);
    await recovered.start();
    assert.equal((await recovered.service.status()).state.planningContext.confirmed.id, proposed.id);
  } finally {
    await store.close();
  }
});
