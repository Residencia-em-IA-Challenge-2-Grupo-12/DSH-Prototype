import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, digest } from '../../src/core.mjs';
import { createStateStore } from '../../src/state-store.mjs';
import { createExclusiveRunManager } from '../../src/foundation/exclusive-run-manager.mjs';
import { startCalendarpitRun } from '../../src/foundation/calendarpit-runner.mjs';
import { authorizeSyntheticCalendar } from '../../src/foundation/synthetic-calendar-auth.mjs';
import { createClaimedCalendar } from '../../src/foundation/claimed-calendar.mjs';
import { inspectDockerCalendar, inspectDockerNetwork } from '../../src/foundation/docker-retirement.mjs';
import { archiveSyntheticRun } from '../../src/foundation/run-archive.mjs';
import { browser } from '../../tests/browser-review/browser.mjs';
import { checkinCopy } from './copy.mjs';
import { scenarios } from './scenarios.mjs';

const [mode, directory] = process.argv.slice(2);
assert.ok(['--scripted', '--calendarpit'].includes(mode) && directory, 'Use --scripted or --calendarpit and a new artifact directory');
const out = path.resolve(directory);
await mkdir(out, { mode: 0o700 });
const root = await mkdtemp('/tmp/study-checkin-restart-');
const fixture = JSON.parse(await readFile(path.join(ROOT, 'fixtures/calendars/ana.json'), 'utf8'));
const port = Number(process.env.STUDY_BROWSER_TEST_PORT || 4274);
assert.ok(Number.isInteger(port) && port > 1023 && port < 65536);
const origin = 'http://127.0.0.1:' + port;
const evidence = { mode, model: 'scripted', processes: [], observations: [], passed: false };
let companion, simulator, observe, stateDirectory, baseline;
const stopCompanion = async () => {
  if (!companion) return;
  const old = companion;
  if (old.exitCode === null && old.signalCode === null) {
    const exit = once(old, 'exit');
    assert.ok(old.kill('SIGKILL'));
    assert.deepEqual(await exit, [null, 'SIGKILL']);
  }
  companion = null;
};

const manager = await createExclusiveRunManager({ root, driverFactory: ({ lease }) => ({
  async start(run) {
    const redirectUri = 'http://127.0.0.1:4175/callback';
    stateDirectory = path.join(root, 'runs', run.id);
    const store = createStateStore(stateDirectory);
    try { await store.create(run.student, { student: run.student }); }
    finally { await store.close(); }
    if (mode === '--calendarpit') {
      simulator = await startCalendarpitRun({ fixture, redirectUri, runId: run.id });
      const accessToken = await authorizeSyntheticCalendar({ run: simulator, student: run.student, redirectUri });
      const calendar = createClaimedCalendar({ origin: simulator.origin, accessToken, getClaim: async () => null });
      observe = () => calendar.events(run.student);
    } else observe = async () => structuredClone(fixture.events);
    baseline = await observe();
  },
  async stopWriters() { await stopCompanion(); },
  async archive(run) {
    const store = createStateStore(stateDirectory);
    try {
      return await archiveSyntheticRun({ directory: path.join(out, 'archive'), run,
        snapshot: await store.snapshotForArchive(run.student),
        observation: { availability: 'available', events: await observe() } });
    } finally { await store.close(); }
  },
  async stopSimulator() { await simulator?.close(); },
  async verifyRetired(run) {
    if (!simulator) return !companion;
    const [calendar, network] = await Promise.all([
      inspectDockerCalendar({ runId: run.id, lease }), inspectDockerNetwork({ runId: run.id, kind: 'calendar', lease }),
    ]);
    return !companion && calendar.state === 'absent' && network.state === 'absent';
  },
}) });

async function bootCompanion(run) {
  await stopCompanion();
  assert.deepEqual(await manager.current(), run);
  const worker = fork(fileURLToPath(new URL('./restart-companion.mjs', import.meta.url)), [], {
    env: {}, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  companion = worker;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Companion did not start')), 15000);
    worker.once('exit', () => { clearTimeout(timeout); reject(Error('Companion exited before startup')); });
    worker.once('error', error => { clearTimeout(timeout); reject(error); });
    worker.on('message', async message => {
      if (message.type === 'ready') {
        clearTimeout(timeout);
        resolve();
      } else if (message.type === 'observe') {
        let events;
        try { events = await observe(); } catch { /* report unavailable */ }
        if (worker.connected) worker.send({ id: message.id, events }, () => {});
      }
    });
  });
  worker.send({ run, directory: stateDirectory, port });
  await ready;
  evidence.processes.push(worker.pid);
}

const [note, change] = scenarios.conflicting.notes;
function minutes(blocks, date) {
  return blocks.filter(block => !date || block.start.dateTime.startsWith(date)).reduce((sum, block) =>
    sum + (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60000, 0);
}
const check = (status, phase, hours, fridayHours, section = 'near') => {
  const { plan, planningContext: { confirmed, pending } } = status.state;
  const date = section === 'near' ? '2026-11-06' : '2026-11-13';
  assert.equal(minutes(plan[section]), hours * 60);
  assert.equal(minutes(plan[section], date), fridayHours * 60);
  assert.deepEqual(status.events, baseline);
  evidence.observations.push({ phase, studyMinutes: minutes(plan[section]), fridayMinutes: minutes(plan[section], date),
    planId: plan.id, planPreferenceId: plan.preferenceRevisionId,
    confirmed: confirmed && { id: confirmed.id, confirmedAt: confirmed.confirmedAt, supersedesId: confirmed.supersedesId,
      sourceIds: confirmed.sourceIds, expired: confirmed.expired },
    pendingId: pending?.id ?? null });
};

let run;
try {
  run = await manager.start('ana');
  evidence.runId = run.id;
  await bootCompanion(run);
  await browser(origin, async ({ call, click, evaluate, wait, fill, capture }) => {
    const send = async text => { await fill('#text', text); await click('#send'); };
    const status = () => evaluate(`fetch('/api/status?runId=${run.id}').then(r=>r.json())`);
    const confirm = async () => {
      await wait("document.querySelector('#planning-context > button:not(:disabled)')");
      await click('#planning-context > button');
      await wait("document.querySelector('#planning-context').innerText.includes('Confirmed inputs')");
    };
    const reboot = async () => {
      await bootCompanion(run);
      await call('Page.reload', { ignoreCache: true });
      await wait("document.querySelector('#messages').innerText.includes('Review restored from this synthetic run')");
    };

    await wait("document.querySelector('#send:not(:disabled)')");
    await send(note);
    await confirm();
    const original = await status();
    const first = original.state.planningContext.confirmed;
    check(original, 'confirmed restriction', 3, 0);
    await send(change);
    await wait("document.querySelector('#planning-context').innerText.includes('Previously confirmed')");
    const conflict = await status();
    const draft = conflict.state.planningContext.pending;
    assert.equal(conflict.state.plan.id, original.state.plan.id);

    await reboot();
    const restored = await status();
    check(restored, 'recovered with pending conflict', 3, 0);
    assert.deepEqual(restored.state, conflict.state);
    const stale = await evaluate(`fetch('/api/context/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(
      JSON.stringify({ runId: run.id, revisionId: first.id }))}}).then(r=>r.status)`);
    assert.equal(stale, 400);
    evidence.staleConfirmationRejected = true;
    const approve = await evaluate(`fetch('/api/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(
      JSON.stringify({ runId: run.id, planId: restored.state.plan.id, section: 'near' }))}}).then(r=>r.status)`);
    assert.equal(approve, 400);
    evidence.recoveredPreviewApprovalRejected = true;
    await click('#nav-context');
    await click('#planning-context > details > summary');
    await capture(path.join(out, 'restored-review.png'));
    await confirm();
    const revised = await status();
    check(revised, 'replacement confirmed', 4, 1);
    assert.equal(revised.state.planningContext.confirmed.id, draft.id);
    assert.equal(revised.state.planningContext.confirmed.supersedesId, first.id);
    assert.equal(revised.state.plan.preferenceRevisionId, draft.id);

    await send(checkinCopy.en.advance);
    await wait("document.querySelector('#planning-context').innerText.includes('Expired preference')");
    const expired = await status();
    await reboot();
    const later = await status();
    check(later, 'expiry after second restart', 4, 2, 'future');
    assert.deepEqual(later.state, expired.state);
    assert.equal(later.state.planningContext.confirmed.expired, true);
    assert.equal(later.state.plan.preferenceRevisionId, null);
    assert.equal(await evaluate("document.querySelectorAll('#proposal button:not(:disabled)').length"), 0);
    await click('#nav-context');
    await capture(path.join(out, 'expired-review.png'));
  });
  assert.equal(new Set(evidence.processes).size, 3);
  assert.deepEqual(await observe(), baseline);
  evidence.calendar = { events: baseline.length, digest: digest(baseline) };
  evidence.passed = true;
} catch (error) {
  evidence.failure = error.message;
  throw error;
} finally {
  try {
    const remaining = await manager.current();
    if (remaining) {
      evidence.retirement = 'unverified';
      evidence.retired = await manager.retire({ expectedRunId: remaining.id });
      const archived = await readFile(path.join(out, 'archive', remaining.id + '.json'), 'utf8');
      assert.ok(!archived.includes(note) && !archived.includes(change));
      evidence.archiveExcludesNotes = true;
      evidence.retirement = 'verified';
    }
  } finally {
    try { await manager.close(); }
    finally {
      if (evidence.retired) await rm(root, { recursive: true });
      else if (evidence.retirement === 'unverified') console.error('Unresolved synthetic run preserved in ' + root);
      await writeFile(path.join(out, 'result.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    }
  }
}
console.log('Verified three companion processes for one managed run: ' + path.join(out, 'result.json'));
