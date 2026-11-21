import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../core.mjs';
import { inputSchema, jsonSchemas } from './contract.mjs';

const cases = path.join(ROOT, 'fixtures/paired-replay');
export const digestBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const json = data => JSON.stringify(data, null, 2) + '\n';

async function checkedFile(directory, relative) {
  const file = path.join(directory, relative);
  const info = await lstat(file);
  if (!info.isFile() || info.size > 5_000_000 || await realpath(file) !== file) {
    throw new Error(`Expected a regular file within the synthetic bundle: ${relative}`);
  }
  return readFile(file);
}

export async function verifyWorkspace(directory, sources) {
  if (!(await lstat(directory)).isDirectory()) throw new Error('Expected a plain synthetic workspace directory');
  const root = await realpath(directory);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (!entry.isFile()) throw new Error('Synthetic workspace must contain regular files only');
    files.push(path.relative(root, path.join(entry.parentPath, entry.name)));
  }
  if (files.sort().join('\n') !== sources.map(source => source.path).sort().join('\n')) {
    throw new Error('Workspace files do not match the declared sources');
  }
  const contents = new Map();
  for (const source of sources) {
    const bytes = await checkedFile(root, source.path);
    if (digestBytes(bytes) !== source.sha256) throw new Error(`Source hash differs: ${source.path}`);
    contents.set(source.path, bytes);
  }
  return contents;
}

function parseManifest(bytes) {
  const manifest = inputSchema.parse(JSON.parse(bytes));
  const different = values => new Set(values).size === values.length;
  if (manifest.student !== manifest.calendar.student || !different(manifest.sources.map(source => source.path)) ||
      !different(manifest.operator.answers.map(answer => answer.id)) ||
      !manifest.sources.some(source => source.path === manifest.expect.deadline.source)) {
    throw new Error('Case requires a matching student, distinct sources and answers, and a declared expected source');
  }
  return manifest;
}

function checkedCalendar(bytes, manifest) {
  if (digestBytes(bytes) !== manifest.calendar.sha256) throw new Error('Calendar hash differs');
  const fixture = JSON.parse(bytes);
  if (!fixture || Object.keys(fixture).sort().join(',') !== 'calendars,events,users' ||
      !Array.isArray(fixture.users) || fixture.users.length !== 1 ||
      fixture.users[0]?.id !== manifest.student || !/^[^@]+@[^@]+\.test$/i.test(fixture.users[0]?.email) ||
      !Array.isArray(fixture.calendars) || fixture.calendars.length !== 1 ||
      fixture.calendars[0]?.id !== `${manifest.student}-calendar` || fixture.calendars[0]?.userId !== manifest.student ||
      fixture.calendars[0]?.timeZone !== manifest.clock.timezone || !Array.isArray(fixture.events) ||
      fixture.events.some(event => typeof event?.id !== 'string' || event.calendarId !== fixture.calendars[0].id) ||
      new Set(fixture.events.map(event => event.id)).size !== fixture.events.length) {
    throw new Error('Expected a credential-free calendar for the declared synthetic student');
  }
  return fixture;
}

export async function readBundle(directory) {
  const root = await realpath(directory);
  const bytes = await checkedFile(root, 'case.json');
  const manifest = parseManifest(bytes);
  const fixture = checkedCalendar(await checkedFile(root, 'calendar.json'), manifest);
  await verifyWorkspace(path.join(root, 'workspace'), manifest.sources);
  return { manifest, inputSha256: digestBytes(bytes), fixture };
}

export async function packBundle(caseId, destination) {
  if (!['bruno', 'ana-held-out'].includes(caseId)) throw new Error('Unknown portable case');
  const directory = path.join(cases, caseId);
  const bytes = await checkedFile(directory, 'case.json');
  const manifest = parseManifest(bytes);
  if (manifest.id !== caseId) throw new Error('Case ID does not match the fixture');
  const checkedIn = JSON.parse(await readFile(path.join(ROOT, 'fixtures/calendars', manifest.student + '.json')));
  const calendar = json({ users: checkedIn.users, calendars: checkedIn.calendars, events: checkedIn.events });
  checkedCalendar(calendar, manifest);
  const sources = await verifyWorkspace(caseId === 'bruno' ? path.join(ROOT, 'fixtures/cold-start/bruno-text') :
    path.join(directory, 'workspace'), manifest.sources);
  await mkdir(destination, { mode: 0o700 });
  try {
    await writeFile(path.join(destination, 'case.json'), bytes, { flag: 'wx' });
    await writeFile(path.join(destination, 'calendar.json'), calendar, { flag: 'wx' });
    for (const [filename, contents] of sources) {
      const target = path.join(destination, 'workspace', filename);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents, { flag: 'wx' });
    }
    for (const [name, schema] of Object.entries(jsonSchemas())) {
      await writeFile(path.join(destination, `${name}.schema.json`), json(schema), { flag: 'wx' });
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
