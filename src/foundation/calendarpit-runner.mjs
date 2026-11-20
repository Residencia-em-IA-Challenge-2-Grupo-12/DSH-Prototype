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
