// Child of the experiment controller. IPC supplies read-only synthetic
// calendar observations. The child receives no provider credentials.
import { once } from 'node:events';
import path from 'node:path';
import { ROOT } from '../../src/core.mjs';
import { createStateStore } from '../../src/state-store.mjs';
import { createManagedStudyApi } from '../../src/foundation/managed-study-api.mjs';
import { createManagedWeb } from '../../src/foundation/managed-web.mjs';
import { createCheckinLoop } from './loop.mjs';
import { createCheckinStorage } from './storage.mjs';
import { scenarios } from './scenarios.mjs';

const [boot] = await once(process, 'message');
const { run, directory, port } = boot;
let sequence = 0;
const requests = new Map();
const calendar = {
  events() {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      requests.set(id, { resolve, reject });
      process.send({ type: 'observe', id });
    });
  },
};
process.on('message', message => {
  const request = requests.get(message.id);
  if (!request) return;
  requests.delete(message.id);
  if (message.events) request.resolve(message.events);
  else request.reject(new Error('Synthetic calendar is unavailable'));
});

const store = createStateStore(directory);
const loop = createCheckinLoop({
  calendar,
  storage: createCheckinStorage(store, run.id, run.student),
  interpret: async ({ latest }) => {
    const scenario = scenarios.conflicting;
    const expected = scenario.expected[scenario.notes.indexOf(latest)];
    if (!expected) throw Error('Use the scripted restart exercise replies');
    return { ...expected, validThrough: '2026-11-08' };
  },
});
await loop.start();
const api = createManagedStudyApi({
  manager: { current: async () => run },
  driver: { active: id => id === run.id ? { ...loop, student: run.student } : null },
});
const origin = 'http://127.0.0.1:' + port;
const server = createManagedWeb({
  api: { ...api, async runStatus() {
    return { ...await api.runStatus(), runtime: 'scripted-review', student: run.student, caseId: 'checkin-restart' };
  } },
  origin, publicDirectory: path.join(ROOT, 'public'),
});
server.listen(port, '127.0.0.1');
await once(server, 'listening');
process.send({ type: 'ready' });
process.on('disconnect', async () => {
  server.close();
  server.closeAllConnections();
  await store.close();
});
