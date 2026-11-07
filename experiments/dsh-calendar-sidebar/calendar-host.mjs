// Isolated feasibility spike. Run from DSH-Prototype, where pinned packages
// are installed. No server, real data, credentials or external services.
import { createRequire } from 'node:module';
const requireFromProject = createRequire(process.cwd() + '/package.json');
const load = name => import(requireFromProject.resolve(name));
const { Context } = await load('@deepseek-ai/cordis');
const { default: Registry } = await load('@deepseek-ai/dsh-typert-registry');
const { default: Access } = await load('@deepseek-ai/dsh-api-remote-access');
const { default: Gateway } = await load('@deepseek-ai/dsh-api-gateway');
const { TypertRemoteService, Remote, remoteMethods } = await load('@deepseek-ai/dsh-typert-protocol');

let markRemoteRead;
// Equivalent to @Remote('read') for a public instance method in plain JS.
Remote('read')(undefined, { kind: 'method', name: 'read', private: false, static: false,
  addInitializer(initializer) { markRemoteRead = initializer; } });

class SyntheticCalendar extends TypertRemoteService {
  constructor(ctx) { super(ctx, 'calendarSpike'); markRemoteRead.call(this); }
  async read(scenarioId) {
    // This allowlist is required even for owner callers, whom RemoteAccess admits.
    if (scenarioId !== 'fixture-a') throw new Error('Unknown synthetic scenario');
    return { scenarioId, events: [{ id: 'test-event', summary: 'Synthetic class' }] };
  }
}

export async function createTestHost() {
  const root = new Context();
  const fibers = [];
  fibers.push(await root.plugin(Registry));
  fibers.push(await root.plugin(Access));
  fibers.push(await root.plugin(Gateway));
  fibers.push(await root.plugin(SyntheticCalendar));
  return { root, markers: remoteMethods(root.calendarSpike), async disposeCalendar() { await fibers.pop().dispose(); }, async dispose() {
    for (const fiber of fibers.reverse()) await fiber.dispose();
  } };
}
