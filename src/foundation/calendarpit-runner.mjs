// Local test orchestrator. Never expose Docker access or the management port to agent workers.
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

export const CALENDARPIT_IMAGE = 'ghcr.io/iktakahiro/calendarpit:0.9.7@sha256:6baaca2eb2e587dbc52f9e63f7bc787188569578a6cba2981b1e380c91e54e96';
const execFileAsync = promisify(execFile);
const docker = async (...args) => (await execFileAsync('docker', args, { timeout: 20_000, maxBuffer: 64 * 1024 })).stdout.trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function syntheticSeed(fixture, redirectUri) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) throw new Error('A synthetic fixture is required');
  if (!Array.isArray(fixture.users) || !fixture.users.length || fixture.users.some(user => !user.id || !/^[^@]+@[^@]+\.test$/i.test(user.email || ''))) {
    throw new Error('Fixture users require explicit IDs and synthetic .test email addresses');
  }
  for (const key of ['calendars', 'events']) {
    if (!Array.isArray(fixture[key]) || fixture[key].some(record => !record.id)) throw new Error(`Fixture ${key} require explicit IDs`);
  }
  let redirect;
  try { redirect = new URL(redirectUri); } catch { throw new Error('A loopback OAuth redirect is required'); }
  if (redirect.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname) || !redirect.port || redirect.username || redirect.password) {
    throw new Error('OAuth redirect must be HTTP loopback with an explicit port');
  }
  const secret = randomBytes(32).toString('base64url');
  const client = { id: `study-${randomUUID()}`, secret, redirectUris: [redirect.href] };
  return { fixture: { users: structuredClone(fixture.users), calendars: structuredClone(fixture.calendars), events: structuredClone(fixture.events), clients: [client] }, client };
}

/** Start one isolated, disposable synthetic Calendarpit instance.
 * The returned OAuth credentials are temporary local test credentials: never log or export them.
 * Call close() in a finally block. Startup failures also clean up created resources.
 */
export async function startCalendarpitRun({ fixture, redirectUri, runDocker = docker, fetchHealth = fetch, wait = sleep, startupTimeoutMs = 15_000 }) {
  const prepared = syntheticSeed(fixture, redirectUri);
  const id = randomUUID();
  const container = `study-calendar-${id}`;
  const network = `study-calendar-net-${id}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-calendar-'));
  const filename = path.join(directory, 'fixture.json');
  let networkCreated = false;
  let containerAttempted = false;
  let closed = false;
  const close = async () => {
    if (closed) return;
    const failures = [];
    if (containerAttempted) try { await runDocker('rm', '-f', container); containerAttempted = false; } catch (error) { failures.push(`container cleanup: ${error.message}`); }
    if (networkCreated) try { await runDocker('network', 'rm', network); networkCreated = false; } catch (error) { failures.push(`network cleanup: ${error.message}`); }
    try { await fs.rm(directory, { recursive: true, force: true }); } catch (error) { failures.push(`fixture cleanup: ${error.message}`); }
    if (failures.length) throw new Error(failures.join('; '));
    closed = true;
  };
  try {
    // Docker's non-root process needs read permission on the mounted fixture. The directory
    // remains private and the file is removed on cleanup; it contains only a generated secret.
    await fs.writeFile(filename, JSON.stringify(prepared.fixture), { mode: 0o644 });
    // A dedicated bridge supports loopback port publishing on the target host.
    // It is not an agent-worker network and does not block simulator egress.
    await runDocker('network', 'create', network);
    networkCreated = true;
    containerAttempted = true;
    await runDocker('run', '-d', '--name', container, '--network', network,
      '--publish', '127.0.0.1::4173', '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
      '--mount', `type=bind,source=${filename},target=/fixtures/startup.json,readonly`,
      '--env', 'CALENDARPIT_DATABASE=:memory:', '--env', 'CALENDARPIT_CONFIG=/fixtures/startup.json', CALENDARPIT_IMAGE);
    let mapped;
    try {
      mapped = await runDocker('port', container, '4173/tcp');
    } catch {
      // Do not include Docker command output or logs: they could contain fixture data.
      let status = 'unknown';
      try {
        const result = await runDocker('inspect', '--format', '{{.State.Status}}:{{.State.ExitCode}}', container);
        if (/^[a-z]+:\d+$/.test(result.trim())) status = result.trim();
      } catch { /* preserve a bounded, non-sensitive diagnostic */ }
      throw new Error(`Calendarpit did not expose its host port (container state: ${status})`);
    }
    const match = /^127\.0\.0\.1:(\d+)$/.exec(mapped.trim());
    if (!match) throw new Error('Docker did not publish a loopback-only port');
    const origin = `http://127.0.0.1:${match[1]}`;
    const deadline = Date.now() + startupTimeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetchHealth(`${origin}/__calendarpit/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { ready = true; break; }
      } catch { /* process still starting */ }
      await wait(100);
    }
    if (!ready) throw new Error('Calendarpit did not become ready');
    return { id, origin, client: prepared.client, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Calendarpit startup and cleanup failed'); }
    throw error;
  }
}
