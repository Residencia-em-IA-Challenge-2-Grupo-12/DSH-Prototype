import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { ROOT } from '../../src/core.mjs';
import { createManagedWeb } from '../../src/foundation/managed-web.mjs';
import { browser } from '../../tests/browser-review/browser.mjs';
import { caseIds, lateCommitment } from './widget-cases.mjs';
import { createWidgetExperiment } from './widget-api.mjs';

const [out] = process.argv.slice(2);
if (!out) throw Error('Provide a private artifact directory');
await mkdir(out, { recursive: true });
const initial = JSON.parse(await readFile(new URL('../../fixtures/calendars/ana.json', import.meta.url))).events;
const port = Number(process.env.STUDY_BROWSER_TEST_PORT || 4254);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65531, 'Invalid browser port');
const results = { browser: 'Chrome', runtime: 'real companion and managed HTTP, scripted reviewed inputs and in-memory synthetic calendar', cases: [] };
for (const [index, id] of [...caseIds, 'late-conflict'].entries()) {
  let inserted = false;
  const calendar = { async events() { return structuredClone(inserted ? [...initial, lateCommitment] : initial); } };
  const { api, evidence } = createWidgetExperiment(id === 'late-conflict' ? 'open-choice' : id, calendar);
  const testPort = port + index;
  const origin = 'http://127.0.0.1:' + testPort;
  const server = createManagedWeb({ api, origin, publicDirectory: ROOT + '/public' });
  server.listen(testPort, '127.0.0.1');
  await once(server, 'listening');
  const expectAsk = id === 'open-choice' || id === 'late-conflict';
  try {
    await browser(origin, async ({ click, wait, evaluate, fill, capture }) => {
      const view = selector => evaluate("document.querySelector(" + JSON.stringify(selector) + ")?.innerText");
      await wait("document.querySelector('#start:not(:disabled)')");
      await click('#start');
      await wait("document.querySelector('#send:not(:disabled)')");
      await fill('#text', 'Review the supplied preference');
      await click('#send');
      if (expectAsk) {
        await wait("document.querySelector('#question form')");
        assert.match(await view('#question'), /3 h total, 0 h on Friday/);
        assert.match(await view('#question'), /4 h total, 1 h on Friday/);
        await wait("document.querySelector('.calendar-event.candidate')");
        await click('#nav-chat');
        if (id === 'open-choice') await capture(out + '/choose-friday.png');
        await click('#question input[value="Use 60 minutes on Friday"]');
        if (id === 'late-conflict') inserted = true;
        await click('#question button[type=submit]');
        if (id === 'late-conflict') {
          await wait("document.querySelector('#notice').innerText.includes('now overlaps')");
          assert.equal(evidence.answers.length, 0);
          await wait("document.querySelector('#question input[value=\"Use 60 minutes on Friday\"]').disabled");
          await capture(out + '/late-conflict.png');
          await click('#question input[value="Keep Friday free"]');
          await click('#question button[type=submit]');
        }
        await wait("!document.querySelector('#question form') && document.querySelector('#messages').innerText.includes('Selected for review')");
        const selected = evidence.decisions[0].candidates[id === 'late-conflict' ? 0 : 1];
        assert.deepEqual(evidence.answers, [{ candidateId: selected.id }]);
        assert.equal(selected.protectedMinutes, id === 'late-conflict' ? 0 : 60);
        assert.match(await view('#notice'), /Calendar approval remains separate/);
      } else {
        await wait("document.querySelector('#messages').innerText.includes('4 h total')");
        assert.equal(await evaluate("!!document.querySelector('#question form')"), false);
        assert.match(await view('#messages'), id === 'accepted-fallback' ? /fallback permits one Friday hour/ : /preference expired/);
        assert.equal(evidence.decisions[0].action, 'recommend');
      }
      assert.equal(await evaluate("document.querySelectorAll('#proposal button').length"), 0);
      assert.equal(evidence.approvals, 0);
      const runId = (await evaluate("document.querySelector('#run').textContent")).split(' · ')[1];
      const final = await evaluate("fetch('/api/status?runId=" + runId + "').then(r=>r.json())");
      assert.deepEqual(final.events, inserted ? [...initial, lateCommitment] : initial);
      await click('#retire');
      await click('#retire-confirm button:first-of-type');
      await wait("document.querySelector('#run').textContent === 'No active run'");
    });
    results.cases.push({ ...evidence, caseId: id, expectedWidget: expectAsk, lateOptionRejected: inserted, originalEventsPreserved: true });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
await writeFile(out + '/browser-result.json', JSON.stringify(results, null, 2) + '\n');
console.log('Verified ' + results.cases.length + ' actual-browser cases.');
