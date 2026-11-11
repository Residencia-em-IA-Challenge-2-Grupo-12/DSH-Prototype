import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { CALENDARPIT_IMAGE, startCalendarpitRun } from '../src/foundation/calendarpit-runner.mjs';

const fixture = {
  users: [{ id: 'student', name: 'Student', email: 'student@example.test' }],
  calendars: [{ id: 'calendar', userId: 'student', summary: 'Study', timeZone: 'America/Sao_Paulo', primary: true }],
  events: [{ id: 'event', calendarId: 'calendar', summary: 'Class', start: { dateTime: '2026-11-02T10:00:00-03:00' }, end: { dateTime: '2026-11-02T11:00:00-03:00' } }],
  clients: [{ id: 'old-client', secret: 'must-not-be-used', redirectUris: ['http://127.0.0.1:4175/callback'] }]
};
const redirectUri = 'http://127.0.0.1:4175/callback';

function fakeDocker({ invalidPort = false } = {}) {
  const calls = [];
  let mountedFile;
  let mountedSeed;
  const runDocker = async (...args) => {
    calls.push(args);
    if (args[0] === 'run') {
      const mount = args[args.indexOf('--mount') + 1];
      mountedFile = mount.match(/^type=bind,source=(.*),target=/)[1];
      mountedSeed = JSON.parse(await fs.readFile(mountedFile, 'utf8'));
      return 'container-id';
    }
    if (args[0] === 'port') return invalidPort ? '0.0.0.0:55000' : '127.0.0.1:55000';
    return '';
  };
  return { runDocker, calls, get mountedFile() { return mountedFile; }, get mountedSeed() { return mountedSeed; } };
}

test('isolated runs use loopback, distinct resources and generated synthetic credentials', async () => {
  const fake = fakeDocker();
  const options = { fixture, redirectUri, runDocker: fake.runDocker, fetchHealth: async () => ({ ok: true }) };
  const first = await startCalendarpitRun(options);
  const firstFile = fake.mountedFile;
  assert.notEqual(first.client.secret, 'must-not-be-used');
  assert.equal(fake.mountedSeed.clients[0].secret, first.client.secret);
  assert.equal(fixture.clients[0].secret, 'must-not-be-used', 'input fixture remains untouched');
  const second = await startCalendarpitRun(options);
  const secondFile = fake.mountedFile;
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.client.secret, second.client.secret);
  assert.equal(first.origin, 'http://127.0.0.1:55000');
  const runs = fake.calls.filter(call => call[0] === 'run');
  assert.equal(runs.length, 2);
  assert(runs.every(call => call.includes('127.0.0.1::4173') && call.includes(CALENDARPIT_IMAGE)));
  assert(runs.every(call => !call.join(' ').includes(first.client.secret) && !call.join(' ').includes(second.client.secret)));
  const networks = fake.calls.filter(call => call[0] === 'network' && call[1] === 'create');
  assert.equal(networks.length, 2);
  assert.notEqual(networks[0].at(-1), networks[1].at(-1));
  await first.close(); await first.close(); await second.close();
  await assert.rejects(() => fs.access(firstFile));
  await assert.rejects(() => fs.access(secondFile));
  assert.equal(fake.calls.filter(call => call[0] === 'rm').length, 2);
  assert.equal(fake.calls.filter(call => call[0] === 'network' && call[1] === 'rm').length, 2);
});

test('invalid exposure triggers cleanup and real-account fixtures are rejected before Docker', async () => {
  const fake = fakeDocker({ invalidPort: true });
  await assert.rejects(() => startCalendarpitRun({ fixture, redirectUri, runDocker: fake.runDocker }), /loopback-only/);
  assert(fake.calls.some(call => call[0] === 'rm'));
  assert(fake.calls.some(call => call[0] === 'network' && call[1] === 'rm'));
  await assert.rejects(() => fs.access(fake.mountedFile));
  const invalid = structuredClone(fixture);
  invalid.users[0].email = 'person@example.com';
  const count = fake.calls.length;
  await assert.rejects(() => startCalendarpitRun({ fixture: invalid, redirectUri, runDocker: fake.runDocker }), /synthetic/);
  await assert.rejects(() => startCalendarpitRun({ fixture, redirectUri: 'https://example.com/callback', runDocker: fake.runDocker }), /loopback/);
  assert.equal(fake.calls.length, count);
});

test('missing published port reports bounded container state and cleans up', async () => {
  const fake = fakeDocker();
  const runDocker = async (...args) => {
    if (args[0] === 'port') throw new Error('potentially sensitive daemon output');
    if (args[0] === 'inspect') return 'exited:1';
    return fake.runDocker(...args);
  };
  await assert.rejects(() => startCalendarpitRun({ fixture, redirectUri, runDocker }), error => {
    assert.match(error.message, /container state: exited:1/);
    assert.doesNotMatch(error.message, /sensitive/);
    return true;
  });
  assert(fake.calls.some(call => call[0] === 'rm'));
  assert(fake.calls.some(call => call[0] === 'network' && call[1] === 'rm'));
  await assert.rejects(() => fs.access(fake.mountedFile));
});
