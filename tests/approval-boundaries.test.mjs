import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, readJSON, resetScenario, draft, applyApproved, loadState } from '../src/core.mjs';

class Calendar {
  async reset(student) {
    this.items = structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);
    this.failCreate = false;
  }
  async events() { return structuredClone(this.items); }
  async create(_student, event) {
    if (this.failCreate) throw new Error('injected create failure');
    this.items.push(structuredClone(event));
    return event;
  }
  async remove(_student, id) { this.items = this.items.filter(event => event.id !== id); }
  async patch(_student, id, changes) { Object.assign(this.items.find(event => event.id === id), changes); }
}

test('a proposal and invalid approval requests leave the calendar unchanged', async () => {
  const calendar = new Calendar();
  await resetScenario(calendar, 'ana');
  const before = await calendar.events();
  const proposal = await draft(calendar, 'ana', { weeks: 2, hours: 2 });
  assert.deepEqual(await calendar.events(), before, 'absence of approval cannot write');
  await assert.rejects(() => applyApproved(calendar, 'ana', 'wrong-proposal', 'near'), /not pending/);
  await assert.rejects(() => applyApproved(calendar, 'ana', proposal.id, 'rejected'), /Unknown approval section/);
  assert.deepEqual(await calendar.events(), before);
  assert.deepEqual((await loadState('ana')).plan.status, { near: 'pending', future: 'pending' });
});

test('partial replacement records removed IDs and actual surviving calendar state', async () => {
  const calendar = new Calendar();
  await resetScenario(calendar, 'ana');
  const first = await draft(calendar, 'ana', { weeks: 1, hours: 2 });
  await applyApproved(calendar, 'ana', first.id, 'near');
  const replacement = await draft(calendar, 'ana', { weeks: 1, hours: 1 });
  const expectedRemoved = replacement.remove.near.map(event => event.id);
  assert.equal(expectedRemoved.length, first.near.length);
  calendar.failCreate = true;
  await assert.rejects(() => applyApproved(calendar, 'ana', replacement.id, 'near'), /PARTIAL/);
  const actual = await calendar.events();
  const state = await loadState('ana');
  const entry = state.history.findLast(item => item.type === 'partial-write');
  assert.deepEqual(entry.removed, expectedRemoved);
  assert.deepEqual(entry.written, []);
  assert(expectedRemoved.every(id => !actual.some(event => event.id === id)));
  assert(!actual.some(event => event.id === replacement.near[0].id));
  assert.equal(state.plan.status.near, 'partial');
  assert.deepEqual(state.lastSnapshot.map(event => event.id).sort(), actual.map(event => event.id).sort());
  await assert.rejects(() => applyApproved(calendar, 'ana', replacement.id, 'near'), /not pending/);
});
