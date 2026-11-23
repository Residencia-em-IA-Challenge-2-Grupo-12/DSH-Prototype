import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT } from '../../src/core.mjs';
import { StudySession } from '../../src/sdk-session.mjs';
import { createExclusiveRunManager } from '../../src/foundation/exclusive-run-manager.mjs';
import { createHostLunaDriver } from '../../src/foundation/host-luna-driver.mjs';
import { createManagedStudyApi } from '../../src/foundation/managed-study-api.mjs';
import { createManagedWeb } from '../../src/foundation/managed-web.mjs';
import { browser } from '../../tests/browser-review/browser.mjs';
import { advanceMessage, createCheckinLoop } from './loop.mjs';

const [mode, directory] = process.argv.slice(2);
assert.ok(['--scripted', '--live'].includes(mode) && directory, 'Use --scripted or --live followed by a new artifact directory');
const live = mode === '--live';
const dshHome = process.env.STUDY_LUNA_DSH_HOME;
if (live) assert.ok(path.isAbsolute(dshHome || ''), 'Set STUDY_LUNA_DSH_HOME to the existing local profile');
const out = path.resolve(directory);
await mkdir(out, { mode: 0o700 });
const source = await readFile(path.join(ROOT, 'fixtures/calendars/ana.json'), 'utf8');
const baseline = JSON.parse(source).events;
const digest = value => createHash('sha256').update(value).digest('hex');
const result = {
  version: 1, mode: live ? 'host-luna-fallback / Calendarpit' : 'scripted / in-memory synthetic calendar',
  ...(live ? { model: 'gpt-6-luna', provider: 'codex', harness: '0.2.2-rc.1' } : {}),
  fixtureSha256: digest(source), usage: live ? 'unknown' : 'none', observations: [], captures: [],
};
const start = Date.now();
const note = 'Friday study felt too demanding last week. Mark Friday afternoon as something to reconsider for November 2 through November 8.';
const correction = 'To clarify, for November 2 through November 8 this is a soft preference: keep Friday afternoon free if possible. I aim for four study hours, and I have not agreed to a Friday fallback.';
let hostDriver, manager, root, exercise, run, server;
const runtime = live ? 'host-luna-fallback' : 'scripted-review';

function parseReply(text) {
  return JSON.parse(text.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g, ''));
}

async function interpret(client, context) {
  if (!live) return { kind: context.previous ? 'soft' : 'unknown', validThrough: '2026-11-08', fallbackMinutes: null };
  const packet = {
    task: 'Interpret a fictional check-in about Friday afternoon as a proposed input for human review. Do not ask questions or use tools. Reply only with one JSON object with kind, validThrough (YYYY-MM-DD, inclusive), and fallbackMinutes (null, 0, or 60).',
    rules: 'Use hard for an explicit prohibition or unavailability. Use soft for an explicit preference or flexibility. Use unknown if strength is unclear. Never infer certainty from frustration. Use the stated dates within this planning week, and set fallbackMinutes only for an explicit zero- or one-hour fallback. Do not infer agreement. The latest message can correct a previous interpretation.',
    ...context,
  };
  const turn = { packet };
  result.captures.push(turn);
  const began = Date.now();
  try {
    const prior = new Set((await client.snapshot()).messages.map(item => item.id));
    let view = await client.prompt(JSON.stringify(packet));
    for (;;) {
      const messages = view.messages.filter(item => !prior.has(item.id));
      turn.messages = messages;
      if (view.question) throw Error('Luna asked a question instead of returning structured data');
      if (view.error) throw Error('Luna reported an execution error');
      if (!view.busy) {
        assert.ok(messages.every(item => ['user', 'assistant'].includes(item.type)), 'Luna emitted unexpected activity');
        const response = messages.filter(item => item.type === 'assistant').at(-1);
        assert.ok(response, 'Luna returned no assistant reply');
        return parseReply(response.text);
      }
      if (Date.now() - began > 85_000) throw Error('Luna check-in exceeded the time budget');
      await delay(300);
      view = await client.snapshot();
    }
  } finally {
    turn.durationMs = Date.now() - began;
  }
}

async function setup() {
  if (live) {
    root = await mkdtemp('/tmp/stci-');
    manager = await createExclusiveRunManager({ root, driverFactory: ({ lease }) =>
      hostDriver = createHostLunaDriver({ root, lease, dshHome, coldStart: 'ana',
        sessionFactory: (options, student) => new StudySession(student, { ...options, promptMode: 'check-in', turnTimeoutMs: 80_000 }) }) });
  }
  const api = createManagedStudyApi({
    manager: {
      current: () => run || null,
      async start(student) {
        assert.ok(!run && student === 'ana');
        run = live ? await manager.start(student) : { id: 'checkin-ana-scripted', student, phase: 'active' };
        result.runId = run.id;
        const host = hostDriver?.active(run.id);
        const calendar = { async events() {
          if (!live) return structuredClone(baseline);
          const state = await host.service.status();
          assert.equal(state.calendar.availability, 'available');
          return state.events;
        } };
        exercise = createCheckinLoop({ calendar, interpret: context => interpret(host?.client, context) });
        exercise.service.agent = host?.service.agent;
        await exercise.start();
        return run;
      },
      async retire({ expectedRunId }) {
        assert.equal(run?.id, expectedRunId);
        assert.equal((await exercise.client.snapshot()).busy, false);
        if (live) {
          await manager.retire({ expectedRunId });
          assert.equal(await manager.current(), null);
          assert.equal(await hostDriver.active(expectedRunId), null);
          const archive = await manager.completed(expectedRunId);
          assert.equal(archive?.phase, 'retired');
          assert.match(archive.archiveSha256, /^[a-f0-9]{64}$/);
          result.retired = { archiveSha256: archive.archiveSha256, verified: true };
        }
        run = null;
      },
    },
    driver: { active: id => id === run?.id ? { ...exercise, student: run.student } : null },
  });
  const port = Number(process.env.STUDY_BROWSER_TEST_PORT || 4270);
  assert.ok(Number.isInteger(port) && port > 1023 && port < 65536);
  const origin = 'http://127.0.0.1:' + port;
  server = createManagedWeb({ api: {
    ...api, async runStatus() { return { ...await api.runStatus(), runtime, student: 'ana', caseId: 'check-in-preference' }; },
  }, origin, publicDirectory: path.join(ROOT, 'public') });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return origin;
}

const minutes = blocks => blocks.reduce((sum, block) => sum +
  (Date.parse(block.end.dateTime) - Date.parse(block.start.dateTime)) / 60000, 0);
function measure(blocks, friday) {
  return { studyMinutes: minutes(blocks), fridayMinutes: minutes(blocks.filter(block => block.start.dateTime.startsWith(friday))) };
}

try {
  const origin = await setup();
  await browser(origin, async ({ click, wait, evaluate, fill, capture }) => {
    const view = selector => evaluate('document.querySelector(' + JSON.stringify(selector) + ')?.innerText');
    const status = () => evaluate("fetch('/api/status?runId='+" + JSON.stringify(run.id) + ").then(r=>r.json())");
    const send = async text => { await fill('#text', text); await click('#send'); };
    const confirm = '#planning-context > button';
    await wait("document.querySelector('#start:not(:disabled)')");
    await click('#start');
    await wait("document.querySelector('#send:not(:disabled)')", 35000);
    const initial = await status();
    result.observations.push({ phase: 'initial', ...measure(initial.state.plan.near, '2026-11-06') });
    assert.deepEqual(result.observations.at(-1), { phase: 'initial', studyMinutes: 240, fridayMinutes: 60 });
    await send(note);
    await wait("document.querySelector('#planning-context > button:not(:disabled)')", 95000);
    await click('#nav-context');
    const first = await status();
    const firstKind = exercise.evidence.revisions[0].preference.kind;
    if (!live) assert.equal(firstKind, 'unknown');
    assert.match(await view('#planning-context'), new RegExp(firstKind === 'unknown' ? 'Strength unclear' : 'Strength: ' + firstKind));
    assert.equal(first.state.plan.id, initial.state.plan.id);
    await click('#planning-context > details > summary');
    await capture(path.join(out, '1-interpreted.png'));
    if (firstKind === 'unknown') {
      await click(confirm);
      await wait("document.querySelector('#notice').innerText.includes('Clarify the preference strength')");
      assert.equal((await status()).state.plan.id, initial.state.plan.id);
    }
    result.observations.push({ phase: 'unconfirmed', previewUnchanged: true, expectedKind: 'unknown',
      observedKind: firstKind, unknownConfirmationBlocked: firstKind === 'unknown' ? true : 'not exercised' });

    await send(correction);
    await wait("[...document.querySelectorAll('#messages article')].filter(item => item.textContent.includes('Review the proposed Friday preference')).length === 2", 95000);
    const corrected = await status();
    assert.match(await view('#planning-context'), /Strength: soft/);
    assert.equal(exercise.evidence.revisions[1].preference.fallbackMinutes, null);
    await wait("document.querySelector('#planning-context > button:not(:disabled)')");
    assert.equal(corrected.state.planningContext.previous.id, first.state.planningContext.pending.id);
    assert.equal(corrected.state.plan.id, initial.state.plan.id);
    const stale = await evaluate("fetch('/api/context/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:" +
      JSON.stringify(JSON.stringify({ runId: run.id, revisionId: first.state.planningContext.pending.id })) +
      "}).then(async r=>({ok:r.ok,body:await r.json()}))");
    assert.equal(stale.ok, false);
    assert.match(JSON.stringify(stale.body), /revision changed/);

    await click(confirm);
    await wait("document.querySelector('#question form') && document.querySelector('.calendar-event.candidate')");
    assert.match(await view('#question'), /3 h of study, 0 h on Friday/);
    assert.match(await view('#question'), /4 h of study, 1 h on Friday/);
    await click('#nav-calendar');
    await evaluate("document.querySelector('#calendar .calendar-scroll').scrollTop = 12 * 32");
    await capture(path.join(out, '2-tradeoff.png'));
    await click('#question input[value="Keep Friday free"]');
    await click('#question button[type=submit]');
    await wait("!document.querySelector('#question form') && document.querySelector('#messages').textContent.includes('3 h of study, 0 h on Friday')");
    const selected = await status();
    result.observations.push({ phase: 'confirmed and selected', ...measure(selected.state.plan.near, '2026-11-06'), staleConfirmationBlocked: true });
    assert.deepEqual(result.observations.at(-1), { phase: 'confirmed and selected', studyMinutes: 180, fridayMinutes: 0, staleConfirmationBlocked: true });
    assert.deepEqual(selected.state.planningContext.confirmed.operatorReplies, [note, correction]);

    await send(advanceMessage);
    await wait("document.querySelector('#messages').textContent.includes('The prior preference ended')");
    const next = await status();
    result.observations.push({ phase: 'expired', ...measure(next.state.plan.future, '2026-11-13') });
    assert.deepEqual(result.observations.at(-1), { phase: 'expired', studyMinutes: 240, fridayMinutes: 120 });
    assert.deepEqual(next.state.planningContext.confirmed.operatorReplies, [note, correction]);
    assert.equal(exercise.evidence.selections.at(-1).planningRevisionId, null);
    assert.deepEqual(next.events, initial.events);
    result.originalEvents = next.events.length;
    assert.equal(exercise.evidence.approvalAttempts, 0);
    assert.equal(await evaluate("document.querySelectorAll('#proposal button:not(:disabled)').length"), 0);
    await click('#calendar .calendar-toolbar button:last-child');
    await click('#nav-calendar');
    await evaluate("document.querySelector('#calendar .calendar-scroll').scrollTop = 12 * 32");
    await capture(path.join(out, '3-expired.png'));
    await click('#retire');
    await click('#retire-confirm button:first-of-type');
    await wait("document.querySelector('#run').textContent === 'No active run'", 35000);
  });
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.failure = error.message;
  throw error;
} finally {
  result.evidence = exercise?.evidence;
  result.durationMs = Date.now() - start;
  try {
    const remaining = await manager?.current();
    if (remaining) {
      await manager.retire({ expectedRunId: remaining.id });
      result.retiredAfterFailure = !(await manager.current());
    }
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    try { await manager?.close(); }
    finally { await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }); }
  }
}
console.log('Verified the joined browser walkthrough: ' + path.join(out, 'result.json'));
