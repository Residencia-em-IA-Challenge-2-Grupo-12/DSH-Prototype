import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packBundle, readBundle } from '../src/paired-replay/bundle.mjs';
import { resultSchema } from '../src/paired-replay/contract.mjs';
import { compareObservations } from '../src/paired-replay/dsh-runner.mjs';
import { compareScheduleClaims, validateSchedule } from '../src/paired-replay/schedule.mjs';

const parse = async filename => JSON.parse(await readFile(filename));

test('both cases pack portable inputs without a credential seed or undeclared workspace contents', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'paired-case-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const caseId of ['bruno', 'ana-held-out']) {
    const directory = path.join(root, caseId);
    await packBundle(caseId, directory);
    const { manifest, fixture, inputSha256 } = await readBundle(directory);
    assert.equal(manifest.id, caseId);
    assert.match(inputSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(fixture).sort(), ['calendars', 'events', 'users']);
    for (const name of ['input', 'result']) {
      assert.equal((await parse(path.join(directory, `${name}.schema.json`))).$schema, 'https://json-schema.org/draft/2020-12/schema');
    }
    assert.ok(manifest.sources.every(source => !source.path.includes('preferences')));
    assert.ok(manifest.operator.answers.every(answer => answer.text));
    await assert.rejects(() => packBundle(caseId, directory), { code: 'EEXIST' });
  }
  const bruno = path.join(root, 'bruno');
  await writeFile(path.join(bruno, 'workspace/courses/algoritmos.md'), 'Altered evidence');
  await assert.rejects(() => readBundle(bruno), /Source hash differs/);
  await writeFile(path.join(bruno, 'calendar.json'), '{}');
  await assert.rejects(() => readBundle(bruno), /Calendar hash differs/);
  const ana = path.join(root, 'ana-held-out');
  await rename(path.join(ana, 'workspace'), path.join(root, 'workspace'));
  await symlink(path.join(root, 'workspace'), path.join(ana, 'workspace'));
  await assert.rejects(() => readBundle(ana), /plain synthetic workspace/);
});

const clock = { date: '2026-11-02', timezone: 'America/Sao_Paulo' };
const add = (eventId, start, end) => ({ kind: 'add', eventId, label: 'Study', course: 'Algorithms', start, end });
const reference = {
  sources: [{ course: 'Algorithms', deadline: '2026-12-14T09:00:00-03:00' }],
  sections: {
    near: [],
    future: [add('wednesday', '2026-11-11T23:00:00Z', '2026-11-12T00:00:00Z'),
      add('saturday1', '2026-11-14T14:00:00-03:00', '2026-11-14T15:00:00-03:00'),
      add('saturday2', '2026-11-14T15:15:00-03:00', '2026-11-14T16:15:00-03:00'),
      add('sunday1', '2026-11-15T10:00:00-03:00', '2026-11-15T11:00:00-03:00'),
      add('sunday2', '2026-11-15T11:15:00-03:00', '2026-11-15T12:15:00-03:00')],
  },
};

test('schedule claims use actual blocks and the simulated timezone', () => {
  const claims = compareScheduleClaims(reference, clock, [
    { week: 2, minutes: 240 }, { date: '2026-11-11', minutes: 0 }, { week: 2, minutes: 300 }, { date: '2026-11-12', minutes: 0 },
  ]);
  assert.deepEqual(claims.map(claim => [claim.matches, claim.actualMinutes]), [[false, 300], [false, 60], [true, 300], [true, 0]]);
});

test('independent schedule validation distinguishes adjacency from overlap and checks exclusions', () => {
  const manifest = { clock, expect: { avoidDates: [] } };
  const commitment = end => ({ start: { dateTime: '2026-11-11T19:00:00-03:00' }, end: { dateTime: end } });
  assert.deepEqual(validateSchedule(reference, [commitment('2026-11-11T20:00:00-03:00')], manifest), []);
  assert.match(validateSchedule(reference, [commitment('2026-11-11T20:15:00-03:00')], manifest)[0], /overlaps/);
  manifest.expect.avoidDates.push('2026-11-11');
  assert.match(validateSchedule(reference, [], manifest)[0], /excluded date/);
});

test('approval preflight rejects invalid times and constraints the student did not review', () => {
  const manifest = { clock, expect: { avoidDates: [] } };
  const reviewed = { targetHours: 2, maxDailyStudyHours: 2, studyBreakMinutes: 15, through: '2026-11-08',
    studyWindows: [{ weekday: 3, start: '19:00', end: '22:00' }] };
  const proposal = { ...reference, sections: { near: [
    add('first', '2026-11-04T19:00:00-03:00', '2026-11-04T20:00:00-03:00'),
    add('second', '2026-11-04T20:15:00-03:00', '2026-11-04T21:15:00-03:00'),
  ], future: [] } };
  assert.deepEqual(validateSchedule(proposal, [], manifest, reviewed), []);
  const changed = structuredClone(proposal);
  changed.sections.near[1].end = 'invalid';
  assert.ok(validateSchedule(changed, [], manifest, reviewed).some(finding => /Invalid study interval/.test(finding)));
  changed.sections.near[1].end = '2026-11-04T22:15:00-03:00';
  changed.sections.near[1].start = '2026-11-04T20:05:00-03:00';
  const findings = validateSchedule(changed, [], manifest, reviewed).join('\n');
  for (const check of [/outside reviewed availability/, /daily cap/, /too little break/, /reviewed target/]) assert.match(findings, check);
});

test('an unavailable calendar differs from an observed empty calendar or zero changes', () => {
  const observed = compareObservations([], []);
  const unavailable = compareObservations([], null);
  assert.deepEqual(observed, { availability: 'available', eventCount: 0, added: [], removed: [], changed: [] });
  assert.deepEqual(unavailable, { availability: 'unavailable' });
  const result = { version: 1, caseId: 'bruno', inputSha256: '0'.repeat(64), runId: 'case', engine: {
    name: 'scripted', revision: 'test', mode: 'scripted', model: null, harness: null, tools: [], simulator: null,
  }, durationMs: 1, usage: { availability: 'not_applicable' }, timeline: [
    { kind: 'observation', phase: 'initial', value: observed },
    { kind: 'observation', phase: 'after_approval', value: unavailable },
  ], checks: [], retirement: 'not_observed' };
  assert.equal(resultSchema.safeParse(result).success, true);
  result.timeline[1].value.added = [];
  assert.equal(resultSchema.safeParse(result).success, false);
});
