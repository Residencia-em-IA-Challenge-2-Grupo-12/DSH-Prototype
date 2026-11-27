// Local test orchestrator. Never expose Docker access or the management port to agent workers.
import { randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { digest } from '../domain/planner.mjs';
import { EVAL_CALENDAR_ORIGIN, syntheticHttpUrl } from './eval-transport.mjs';

export const CALENDARPIT_IMAGE = 'ghcr.io/iktakahiro/calendarpit:0.9.7@sha256:6baaca2eb2e587dbc52f9e63f7bc787188569578a6cba2981b1e380c91e54e96';
const execFileAsync = promisify(execFile);
const docker = async (...args) => (await execFileAsync('docker', args, { timeout: 20_000, maxBuffer: 512 * 1024 })).stdout.trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function checkedRunId(runId){
  if(typeof runId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId))throw new Error('Invalid synthetic run ID');
  return runId;
}
async function privateRunDirectory(runDirectory){
  if(typeof runDirectory!=='string'||!path.isAbsolute(runDirectory)||path.normalize(runDirectory)!==runDirectory||runDirectory.includes(','))throw new Error('A valid private run directory is required');
  const root=await fs.lstat(runDirectory);
  if(!root.isDirectory()||(root.mode&0o077)!==0||(process.getuid&&root.uid!==process.getuid()))throw new Error('Simulator run directory must be private');
  return runDirectory;
}

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
export async function startCalendarpitRun({ fixture, redirectUri, runId = randomUUID(), runDirectory, runDocker = docker, fetchHealth = fetch, wait = sleep, startupTimeoutMs = 15_000 }) {
  checkedRunId(runId);
  const prepared = syntheticSeed(fixture, redirectUri);
  const id = runId;
  const container = `study-calendar-${id}`;
  const network = `study-calendar-net-${id}`;
  let directory;
  if(runDirectory!==undefined){
    await privateRunDirectory(runDirectory);
    directory=path.join(runDirectory,'calendarpit-control');
    await fs.mkdir(directory,{mode:0o700}); // Never reuse or replace another run's control files.
  } else directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-calendar-'));
  const filename = path.join(directory, 'fixture.json');
  let networkCreated = false;
  let containerAttempted = false;
  let closed = false;
  const close = async () => {
    if (closed) return;
    const failures = [];
    if (containerAttempted) try { await runDocker('rm', '-f', container); containerAttempted = false; } catch (error) { failures.push(`container cleanup: ${error.message}`); }
    if (networkCreated) try { await runDocker('network', 'rm', network); networkCreated = false; } catch (error) { failures.push(`network cleanup: ${error.message}`); }
    // Keep the synthetic seed and client evidence if a managed resource could
    // still exist. It may be needed for a verified retirement or observation.
    if(!failures.length)try { await fs.rm(directory, { recursive: true, force: true }); } catch (error) { failures.push(`fixture cleanup: ${error.message}`); }
    if (failures.length) throw new Error(failures.join('; '));
    closed = true;
  };
  try {
    // Docker's non-root process needs read permission on the mounted fixture. The directory
    // remains private and the file is removed on cleanup; it contains only a generated secret.
    await fs.writeFile(filename, JSON.stringify(prepared.fixture), { mode: 0o644 });
    // A dedicated bridge supports loopback port publishing on the target host.
    // It is not an agent-worker network and does not block simulator egress.
    await runDocker('network', 'create', '--label', `study.run.id=${id}`, network);
    networkCreated = true;
    containerAttempted = true;
    await runDocker('run', '-d', '--name', container, '--label', `study.run.id=${id}`, '--network', network,'--network-alias','calendarpit',
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
    return { id, origin, client: prepared.client, controlDirectory:directory, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Calendarpit startup and cleanup failed'); }
    throw error;
  }
}

const evalComposeFile = fileURLToPath(new URL('../../compose.eval.yaml', import.meta.url));

async function inspectEvalCalendarNetwork(runDocker, project) {
  const info = JSON.parse(await runDocker('network', 'inspect', '--format', '{{json .}}', `${project}_net_calendar`));
  if (info.Internal !== true || info.Labels?.['com.docker.compose.project'] !== project ||
      info.Labels?.['com.docker.compose.network'] !== 'net_calendar') {
    throw new Error('An internal Compose calendar network is required');
  }
  return info;
}

function matchesSeed(observed, fixture) {
  if (Array.isArray(observed.userIds) && Array.isArray(observed.calendarIds) &&
      Array.isArray(observed.eventIds) && typeof observed.eventsDigest === 'string') {
    return isDeepStrictEqual(observed.userIds, fixture.users.map(item => item.id).sort()) &&
      isDeepStrictEqual(observed.calendarIds, fixture.calendars.map(item => item.id).sort()) &&
      isDeepStrictEqual(observed.eventIds, fixture.events.map(item => item.id).sort()) &&
      observed.eventsDigest === digest(fixture.events);
  }
  for (const key of ['users', 'calendars', 'events']) {
    if (!Array.isArray(observed[key]) || !isDeepStrictEqual(
      observed[key].map(item => item.id).sort(), fixture[key].map(item => item.id).sort(),
    )) return false;
  }
  return digest(observed.events) === digest(fixture.events);
}

/** Host-side lifecycle for Compose Eval. The evaluator must already be running.
 * The shared service alias admits one active calendar per Compose project.
 */
export async function startComposeCalendarpitRun({
  project, fixture, redirectUri, runId = randomUUID(), runDocker = docker, wait = sleep, startupTimeoutMs = 15_000,
} = {}) {
  checkedRunId(runId);
  if (typeof project !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('A valid Compose project name is required');
  const redirect = syntheticHttpUrl(redirectUri, { routes: ['/callback'], requirePort: true });
  if (redirect.hostname !== '127.0.0.1') throw new Error('Compose calendar redirect must be on 127.0.0.1');
  const prepared = syntheticSeed(fixture, redirect.href);
  const network = await inspectEvalCalendarNetwork(runDocker, project);
  const [evaluator] = Object.keys(network.Containers || {});
  if (!evaluator || Object.keys(network.Containers).length !== 1 ||
      await runDocker('inspect', '--format', '{{index .Config.Labels "com.docker.compose.service"}}', evaluator) !== 'evaluator') {
    throw new Error('The Compose calendar network must contain only the evaluator before startup');
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-eval-calendar-'));
  const filename = path.join(directory, 'fixture.json');
  const container = `study-eval-calendar-${network.Id}`;
  const ownerLabel = `study.eval.calendar.owner=${randomUUID()}`;
  const ownedContainers = async () => (await runDocker('ps', '-aq', '--no-trunc', '--filter', `label=${ownerLabel}`))
    .split('\n').filter(Boolean);
  let closing;
  const close = () => {
    return closing ??= (async () => {
      for (const id of await ownedContainers()) await runDocker('rm', '-f', '-v', id);
      if ((await ownedContainers()).length) throw new Error('Compose Calendarpit retirement could not be verified');
      await fs.rm(directory, { recursive: true, force: true });
    })().catch(error => { closing = undefined; throw error; });
  };
  try {
    await fs.writeFile(filename, JSON.stringify(prepared.fixture), { mode: 0o644 });
    await runDocker('compose', '--env-file', '/dev/null', '-p', project, '-f', evalComposeFile, 'run',
      '--detach', '--no-deps', '--use-aliases', '--name', container, '--label', ownerLabel, '--label', `study.run.id=${runId}`,
      '--volume', `${filename}:/fixtures/startup.json:ro`, 'calendarpit');
    const url = EVAL_CALENDAR_ORIGIN + '/__calendarpit/state';
    const probe = `import { digest } from './src/domain/planner.mjs';
      const response = await fetch(${JSON.stringify(url)}, { redirect: 'error', signal: AbortSignal.timeout(1000) });
      if (!response.ok) process.exit(1);
      const { users = [], calendars = [], events = [] } = await response.json();
      console.log(JSON.stringify({
        userIds: users.map(item => item.id).sort(),
        calendarIds: calendars.map(item => item.id).sort(),
        eventIds: events.map(item => item.id).sort(),
        eventsDigest: digest(events),
      }));`;
    const deadline = Date.now() + startupTimeoutMs;
    let observed;
    while (!observed && Date.now() < deadline) {
      try { observed = JSON.parse(await runDocker('exec', evaluator, 'node', '--input-type=module', '-e', probe)); }
      catch { await wait(100); }
    }
    if (!observed || !matchesSeed(observed, prepared.fixture)) throw new Error('Compose Calendarpit did not expose the expected seed');
    const [calendar] = await ownedContainers();
    const attached = await inspectEvalCalendarNetwork(runDocker, project);
    if (!calendar || Object.keys(attached.Containers || {}).length !== 2 || !attached.Containers[evaluator] || !attached.Containers[calendar]) {
      throw new Error('Compose Calendarpit network membership could not be verified');
    }
    return { id: runId, origin: EVAL_CALENDAR_ORIGIN, client: prepared.client, close };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Compose Calendarpit startup and cleanup failed'); }
    throw error;
  }
}

// Read-only inspection for a trusted controller after restart. This verifies
// only simulator identity at this instant; callers must separately fence the
// previous controller and stop/verify all writers before resuming or retiring.
export async function inspectCalendarpitRun({runId,student,runDirectory,runDocker=docker,fetchHealth=fetch}={}){
  checkedRunId(runId);if(!['ana','bruno'].includes(student))throw new Error('Unknown synthetic student');
  await privateRunDirectory(runDirectory);
  const directory=path.join(runDirectory,'calendarpit-control'),dir=await fs.lstat(directory);
  if(!dir.isDirectory()||(dir.mode&0o077)!==0||(process.getuid&&dir.uid!==process.getuid()))throw new Error('Synthetic simulator control directory must be private');
  const filename=path.join(directory,'fixture.json'),info=await fs.lstat(filename);
  if(!info.isFile()||(info.mode&0o022)!==0||(process.getuid&&info.uid!==process.getuid())||info.size>5_000_000)throw new Error('Synthetic simulator fixture is invalid');
  let seed;try{seed=JSON.parse(await fs.readFile(filename,'utf8'));}catch{throw new Error('Synthetic simulator fixture is invalid');}
  if(!Array.isArray(seed.users)||!seed.users.some(user=>user.id===student)||seed.users.some(user=>!user.id||!/^[^@]+@[^@]+\.test$/i.test(user.email||''))||
    !Array.isArray(seed.calendars)||!seed.calendars.every(item=>item.id)||!Array.isArray(seed.events)||!seed.events.every(item=>item.id)||
    !Array.isArray(seed.clients)||seed.clients.length!==1)throw new Error('Synthetic simulator fixture is invalid');
  const client=seed.clients[0];
  if(typeof client.id!=='string'||!/^study-[0-9a-f-]+$/i.test(client.id)||typeof client.secret!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(client.secret)||
    !Array.isArray(client.redirectUris)||client.redirectUris.length!==1)throw new Error('Synthetic simulator client is invalid');
  let redirect;try{redirect=new URL(client.redirectUris[0]);}catch{throw new Error('Synthetic simulator client is invalid');}
  if(redirect.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(redirect.hostname)||!redirect.port||redirect.username||redirect.password)throw new Error('Synthetic simulator client is invalid');
  const container=`study-calendar-${runId}`,network=`study-calendar-net-${runId}`;let observed,networkInfo,mapped;
  try {
    observed=JSON.parse(await runDocker('inspect','--format','{{json .}}',container));
    networkInfo=JSON.parse(await runDocker('network','inspect','--format','{{json .}}',network));
    mapped=await runDocker('port',container,'4173/tcp');
  } catch(error){throw new Error('Synthetic simulator inspection failed; resource state is unknown',{cause:error});}
  if(!/^[a-f0-9]{64}$/.test(observed?.Id||'')||observed.Name!==`/${container}`||observed.Config?.Labels?.['study.run.id']!==runId||
    observed.State?.Running!==true||!Object.hasOwn(observed.NetworkSettings?.Networks||{},network)||
    networkInfo?.Name!==network||networkInfo.Labels?.['study.run.id']!==runId)throw new Error('Synthetic simulator resource identity does not match the run');
  const match=/^127\.0\.0\.1:(\d+)$/.exec(mapped.trim());if(!match)throw new Error('Synthetic simulator is not published on loopback');
  const origin=`http://127.0.0.1:${match[1]}`;
  let ready=false;try{ready=(await fetchHealth(`${origin}/__calendarpit/health`,{signal:AbortSignal.timeout(1000)})).ok===true;}catch{}
  if(!ready)throw new Error('Synthetic simulator observation is unavailable');
  return {id:runId,origin,client,controlDirectory:directory,writersVerified:false};
}
