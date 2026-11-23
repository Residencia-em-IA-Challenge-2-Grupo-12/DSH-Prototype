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
import { createCheckinLoop } from './loop.mjs';
import { checkinCopy } from './copy.mjs';
import { scenarios } from './scenarios.mjs';

const [mode, directory, scenarioName = 'joined'] = process.argv.slice(2);
const scenario = scenarios[scenarioName];
assert.ok(['--scripted', '--live'].includes(mode) && directory && Object.hasOwn(scenarios, scenarioName),
  'Use --scripted or --live, a new artifact directory, and optionally joined, skipped, conflicting, or portuguese');
const { language, notes, expected } = scenario;
const copy = checkinCopy[language];
const [note, correction] = notes;
const live = mode === '--live';
const dshHome = process.env.STUDY_LUNA_DSH_HOME;
if (live) assert.ok(path.isAbsolute(dshHome || ''), 'Set STUDY_LUNA_DSH_HOME to the existing local profile');
const out = path.resolve(directory);
await mkdir(out, { mode: 0o700 });
const source = await readFile(path.join(ROOT, 'fixtures/calendars/ana.json'), 'utf8');
const baseline = JSON.parse(source).events;
const digest = value => createHash('sha256').update(value).digest('hex');
const result = {
  version: 2, scenario: scenarioName, language, mode: live ? 'host-luna-fallback / Calendarpit' : 'scripted / in-memory synthetic calendar',
  ...(live ? { model: 'gpt-6-luna', provider: 'codex', harness: '0.2.2-rc.1' } : {}),
  fixtureSha256: digest(source), usage: live ? 'unknown' : 'none', observations: [], captures: [],
};
const start = Date.now();
let hostDriver, manager, root, exercise, run, server;
const runtime = live ? 'host-luna-fallback' : 'scripted-review';

function parseReply(text) {
  return JSON.parse(text.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g, ''));
}

async function interpret(client, context) {
  if (!live) {
    const reply = { ...expected[result.captures.length], validThrough: '2026-11-08' };
    result.captures.push({ scripted: true, reply });
    return reply;
  }
  const packet = {
    task: 'Interpret a fictional check-in about Friday afternoon as a proposed input for human review. Do not ask questions or use tools. Reply only with one JSON object with kind, validThrough (YYYY-MM-DD, inclusive), and fallbackMinutes (null, 0, or 60).',
    rules: 'Use hard for an explicit prohibition or unavailability. Use soft for an explicit preference or flexibility. Use unknown if strength is unclear. Never infer certainty from frustration. Use the stated dates within this planning week, and set fallbackMinutes only for an explicit zero- or one-hour fallback. Do not infer agreement. The latest message can correct a previous interpretation.',
    noteLanguage: language === 'pt' ? 'Brazilian Portuguese' : 'English',
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
        exercise = createCheckinLoop({ calendar, language, interpret: context => interpret(host?.client, context) });
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

async function exerciseInBrowser({ click, wait, evaluate, fill, capture }) {
  const text = selector => 'document.querySelector(' + JSON.stringify(selector) + ')?.innerText';
  const contains = (selector, value) => text(selector) + '?.includes(' + JSON.stringify(value) + ')';
  const status = () => evaluate("fetch('/api/status?runId='+" + JSON.stringify(run.id) + ").then(r=>r.json())");
  const send = async message => { await fill('#text', message); await click('#send'); };
  const confirm = '#planning-context > button';
  const snapshot = name => capture(path.join(out, name + '.png'));
  const clickConfirm = async () => {
    await wait("document.querySelector('#planning-context > button:not(:disabled)')");
    await click(confirm);
  };
  const confirmStale = async revisionId => {
    const payload = JSON.stringify({ runId: run.id, revisionId });
    const stale = await evaluate("fetch('/api/context/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:" +
      JSON.stringify(payload) + "}).then(async r=>({ok:r.ok,body:await r.json()}))");
    assert.equal(stale.ok, false);
    assert.ok(JSON.stringify(stale.body).includes(copy.staleRevision));
  };
  const submitNote = async (message, index) => {
    await send(message);
    const marker = JSON.stringify(copy.review);
    await wait("[...document.querySelectorAll('#messages article')].filter(item => item.textContent.includes(" + marker + ")).length === " + (index + 1), 95000);
    const state = await status();
    const { preference } = exercise.evidence.revisions[index];
    result.observations.push({ phase: index === 0 ? 'first interpretation' : 'second interpretation',
      expected: expected[index], observed: preference });
    if (!live || index > 0 || scenarioName === 'conflicting') {
      assert.equal(preference.kind, expected[index].kind);
      assert.equal(preference.fallbackMinutes, expected[index].fallbackMinutes);
    }
    assert.equal(preference.validThrough, '2026-11-08');
    assert.ok((await evaluate(text('#planning-context'))).includes(copy.strength[preference.kind]));
    return state;
  };
  const showWeek = async () => {
    await click('#nav-calendar');
    await evaluate("document.querySelector('#calendar .calendar-scroll').scrollTop = 12 * 32");
  };
  await wait("document.querySelector('#start:not(:disabled)')");
  if (language === 'pt') {
    await evaluate("(()=>{const select=document.querySelector('#language');select.value='pt';select.dispatchEvent(new Event('change'));})()");
    await wait("document.documentElement.lang === 'pt-BR'");
    await wait(contains('#start', 'Iniciar cenário'));
  }
  await click('#start');
  await wait("document.querySelector('#send:not(:disabled)')", 35000);
  const initial = await status();
  const firstWeek = (state, hours, fridayHours, phase) => {
    const observed = measure(state.state.plan.near, '2026-11-06');
    assert.deepEqual(observed, { studyMinutes: hours * 60, fridayMinutes: fridayHours * 60 });
    result.observations.push({ phase, ...observed });
  };
  firstWeek(initial, 4, 1, 'initial');

  if (scenarioName === 'skipped') {
    assert.equal(initial.state.planningContext.pending, null);
    assert.equal(initial.state.planningContext.confirmed, null);
    assert.ok((await evaluate(text('#messages'))).includes(copy.invite));
  } else {
    const first = await submitNote(note, 0);
    const firstId = first.state.planningContext.pending.id;
    assert.equal(first.state.plan.id, initial.state.plan.id);
    await click('#nav-context');
    await click('#planning-context > details > summary');
    await snapshot('1-interpreted');

    if (scenarioName === 'conflicting') {
      await clickConfirm();
      await wait(contains('#planning-context', 'Confirmed inputs'));
      const hard = await status();
      firstWeek(hard, 3, 0, 'first confirmation');

      const conflict = await submitNote(correction, 1);
      assert.equal(conflict.state.planningContext.confirmed.id, firstId);
      assert.equal(conflict.state.plan.id, hard.state.plan.id);
      firstWeek(conflict, 3, 0, 'conflict pending');
      assert.deepEqual(conflict.state.planningContext.pending.operatorReplies, notes);
      await wait(contains('#planning-context', 'Previously confirmed') + ' && ' + contains('#planning-context', 'Friday fallback: 60 minutes'));
      await confirmStale(firstId);
      await click('#nav-context');
      await click('#planning-context > details > summary');
      await snapshot('2-conflict-before-confirmation');
      await clickConfirm();
      await wait(contains('#planning-context', 'Confirmed inputs'));
      const revised = await status();
      firstWeek(revised, 4, 1, 'replacement confirmed');
      assert.equal(revised.state.planningContext.confirmed.id, conflict.state.planningContext.pending.id);
      assert.equal(exercise.evidence.revisions[0].status, 'superseded');
      assert.equal(exercise.evidence.selections.at(-1).reason, 'explicit_fallback');
      assert.equal(await evaluate("!!document.querySelector('#question form')"), false);
    } else {
      const firstKind = exercise.evidence.revisions[0].preference.kind;
      if (firstKind === 'unknown') {
        await clickConfirm();
        await wait(contains('#notice', copy.clarify));
        assert.equal((await status()).state.plan.id, initial.state.plan.id);
      }
      result.observations.push({ phase: 'unconfirmed', previewUnchanged: true,
        unknownConfirmationBlocked: firstKind === 'unknown' ? true : 'not exercised' });
      const corrected = await submitNote(correction, 1);
      assert.equal(corrected.state.planningContext.previous.id, firstId);
      assert.equal(corrected.state.plan.id, initial.state.plan.id);
      await confirmStale(firstId);
      await clickConfirm();
      await wait("document.querySelector('#question form') && document.querySelector('.calendar-event.candidate')");
      assert.ok((await evaluate(text('#question'))).includes(copy.outline(3, 0)));
      assert.ok((await evaluate(text('#question'))).includes(copy.outline(4, 1)));
      await showWeek();
      await snapshot('2-tradeoff');
      await click('#question input[value=' + JSON.stringify(copy.keep) + ']');
      await click('#question button[type=submit]');
      await wait("!document.querySelector('#question form') && " + contains('#messages', copy.outline(3, 0)));
      const selected = await status();
      firstWeek(selected, 3, 0, 'confirmed and selected');
      assert.deepEqual(selected.state.planningContext.confirmed.operatorReplies, notes);
    }
    assert.equal((await status()).state.planningContext.pending, null);
  }

  await send(copy.advance);
  await wait(contains('#messages', scenarioName === 'skipped' ? copy.noPreference : copy.expiry('2026-11-08')));
  const next = await status();
  assert.deepEqual(measure(next.state.plan.future, '2026-11-13'), { studyMinutes: 240, fridayMinutes: 120 });
  result.observations.push({ phase: 'next week', ...measure(next.state.plan.future, '2026-11-13') });
  if (scenarioName === 'skipped') {
    assert.equal(next.state.planningContext.confirmed, null);
    assert.deepEqual(exercise.evidence.notes, []);
    assert.deepEqual(exercise.evidence.revisions, []);
    assert.deepEqual(result.captures, []);
    assert.equal(await evaluate("!!document.querySelector('#question form')"), false);
  } else assert.deepEqual(next.state.planningContext.confirmed.operatorReplies, notes);
  assert.equal(exercise.evidence.selections.at(-1).planningRevisionId, null);
  assert.deepEqual(next.events, initial.events);
  result.originalEvents = next.events.length;
  assert.equal(exercise.evidence.approvalAttempts, 0);
  assert.equal(await evaluate("document.querySelectorAll('#proposal button:not(:disabled)').length"), 0);

  const nextWeek = '#calendar .calendar-toolbar button:last-child';
  await evaluate('document.querySelector(' + JSON.stringify(nextWeek) + ').scrollIntoView({ block: "center" })');
  await click(nextWeek);
  await wait(`document.querySelectorAll('.calendar-event.proposed[aria-label*="2026-11-13"]').length === 2`);
  await showWeek();
  await snapshot('3-next-week');
  await click('#retire');
  await click('#retire-confirm button:first-of-type');
  await wait(contains('#run', language === 'pt' ? 'Nenhuma execução ativa' : 'No active run'), 35000);
}

try {
  const origin = await setup();
  await browser(origin, exerciseInBrowser);
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
