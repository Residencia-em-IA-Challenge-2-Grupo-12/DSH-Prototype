import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStateStore } from '../state-store.mjs';
import { EVAL_CALENDAR_ORIGIN, syntheticHttpUrl } from '../foundation/eval-transport.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FIXED_TODAY = '2026-11-02';
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_TIMEZONE_OFFSET = '-03:00';
export const KNOWN_STUDENTS = Object.freeze(['ana', 'bruno']);

const runtimeContext = new AsyncLocalStorage();
const writeLocks = new Set();
const stores = new Map();

// Trusted services may bind operations to a per-run runtime without changing
// process-wide environment; the legacy baseline keeps its existing override.
export function runtimeDir() {
  return path.resolve(runtimeContext.getStore()?.directory || process.env.STUDY_ATLAS_RUNTIME_DIR || path.join(ROOT, '.runtime'));
}

export function requiresStagedWorkspace(required = false) {
  return runtimeContext.getStore()?.requireStaged === true || required;
}

function narrowStudents(...lists) {
  let narrowed;
  for (const list of lists) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new Error('An explicit student allowlist is required');
    narrowed = narrowed === undefined ? [...list] : narrowed.filter(student => list.includes(student));
  }
  return narrowed;
}

export function withSyntheticRuntime(directory, operation, { allowedStudents, requireStaged } = {}) {
  if (
    typeof directory !== 'string' ||
    !path.isAbsolute(directory) ||
    path.normalize(directory) !== directory ||
    directory === path.parse(directory).root ||
    typeof operation !== 'function'
  ) {
    throw new Error('A valid synthetic runtime and operation are required');
  }
  if (allowedStudents !== undefined && !Array.isArray(allowedStudents)) throw new Error('An explicit student allowlist is required');
  if (requireStaged !== undefined && typeof requireStaged !== 'boolean') throw new Error('Workspace policy must be explicit');
  const parent = runtimeContext.getStore();
  const effectiveAllowed = narrowStudents(parent?.allowedStudents, allowedStudents);
  return runtimeContext.run({
    directory,
    allowedStudents: effectiveAllowed === undefined ? undefined : Object.freeze(effectiveAllowed),
    requireStaged: requiresStagedWorkspace(requireStaged),
  }, operation);
}

export async function withWriteLock(student, fn) {
  if (writeLocks.has(student)) throw new Error('Another approval is being applied');
  writeLocks.add(student);
  try {
    return await fn();
  } finally {
    writeLocks.delete(student);
  }
}

export function assertStudent(id, allowed) {
  const effective = narrowStudents(runtimeContext.getStore()?.allowedStudents, allowed) ?? KNOWN_STUDENTS;
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) ||
      !Array.isArray(effective) || !effective.includes(id)) throw new Error('Unknown fixture');
  return id;
}

export async function readJSON(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function writeJSON(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, filePath);
}

export function statePath(student) {
  return path.join(runtimeDir(), `${assertStudent(student)}.json`);
}

export const stateStore = new Proxy({}, {
  get(_target, key) {
    const directory = runtimeDir();
    if (!stores.has(directory)) stores.set(directory, createStateStore(directory));
    return stores.get(directory)[key];
  },
});

export async function disposeSyntheticRuntime(directory) {
  if (
    typeof directory !== 'string' ||
    !path.isAbsolute(directory) ||
    path.normalize(directory) !== directory ||
    directory === path.parse(directory).root
  ) {
    throw new Error('A valid synthetic runtime is required');
  }
  const key = path.resolve(directory);
  const store = stores.get(key);
  if (!store) return false;
  await store.close();
  if (stores.get(key) === store) stores.delete(key);
  return true;
}

export async function loadState(student, allowedStudents) {
  return stateStore.load(assertStudent(student, allowedStudents));
}

export async function saveState(student, state) {
  return stateStore.save(assertStudent(student), state);
}

export async function getRecoveryClaim() {
  return stateStore.getCalendarClaim();
}

export async function snapshotForArchive(student) {
  return stateStore.snapshotForArchive(assertStudent(student));
}

export function addDaysIso(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function timezoneOffsetForDate(isoDate, timeZone = DEFAULT_TIMEZONE) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !Number.isFinite(Date.parse(`${isoDate}T12:00:00Z`))) {
    throw new Error('Invalid planning clock date');
  }
  if (typeof timeZone !== 'string' || !timeZone.trim()) throw new Error('Invalid planning clock timezone');
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(`${isoDate}T12:00:00Z`));
  } catch {
    throw new Error('Invalid planning clock timezone');
  }
  const label = parts.find(part => part.type === 'timeZoneName')?.value;
  if (label === 'GMT' || label === 'UTC') return '+00:00';
  const match = /^(?:GMT|UTC)([+-]\d{2}:\d{2})$/.exec(label || '');
  if (!match) throw new Error('Unsupported planning clock timezone offset');
  return match[1];
}

export function validateClock(today, timezoneOffset) {
  if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(`${today}T00:00:00Z`))) {
    throw new Error('Invalid planning clock date');
  }
  if (typeof timezoneOffset !== 'string' || !/^[+-](?:[01]\d|2[0-3]):[0-5]\d$/.test(timezoneOffset)) {
    throw new Error('Invalid timezone offset');
  }
}

export function localTime(date, offset = DEFAULT_TIMEZONE_OFFSET) {
  return date.toISOString().replace('Z', '').slice(0, 19) + offset;
}

// Calendarpit management endpoints are deliberately local-only and synthetic.
export class Calendarpit {
  #origin;
  #allowedStudents;
  #fixture;
  #requiresFixture;
  #fetch;

  constructor(base = process.env.CALENDARPIT_URL || 'http://127.0.0.1:4173', {
    transport = 'loopback', allowedStudents, fixture, fetchImpl = fetch,
  } = {}) {
    this.#origin = syntheticHttpUrl(base, {
      transport, peer: EVAL_CALENDAR_ORIGIN, routes: ['/'], message: 'Calendarpit must be on loopback or an explicit Compose peer',
    }).origin;
    if (allowedStudents !== undefined && !Array.isArray(allowedStudents)) throw new Error('An explicit student allowlist is required');
    if (fixture !== undefined && (!fixture || !Array.isArray(fixture.events))) throw new Error('Invalid synthetic calendar fixture');
    this.#allowedStudents = allowedStudents === undefined ? undefined : [...allowedStudents];
    this.#fixture = fixture === undefined ? undefined : structuredClone(fixture);
    this.#requiresFixture = transport === 'compose-eval';
    this.#fetch = fetchImpl;
  }

  get base() { return this.#origin; }

  async request(method, route, body) {
    const eventRoute = /^\/calendars\/[A-Za-z0-9_-]+-calendar\/events(?:\/([^/?#]+))?$/.exec(route);
    const validEventRoute = eventRoute && (eventRoute[1]
      ? ['PATCH', 'DELETE'].includes(method) && !/^(?:\.|%2e){1,2}$/i.test(eventRoute[1]) && !eventRoute[1].includes('\\')
      : ['GET', 'POST'].includes(method));
    if (!validEventRoute && !(method === 'POST' && route === '/fixtures')) throw new Error('Unknown Calendarpit management route');
    const res = await this.#fetch(`${this.#origin}/__calendarpit${route}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      const error = new Error(`Calendarpit ${res.status}: ${text}`);
      error.status = res.status;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  }

  async events(student, { allowedStudents } = {}) {
    return (await this.request('GET', this.#eventsRoute(student, allowedStudents))).items;
  }

  async reset(student) {
    assertStudent(student, this.#allowedStudents);
    if (this.#fixture === undefined && (this.#requiresFixture || requiresStagedWorkspace())) {
      throw new Error('Explicit synthetic calendar fixture required');
    }
    return this.request('POST', '/fixtures', this.#fixture ?? await readJSON(path.join(ROOT, 'fixtures/calendars', `${student}.json`)));
  }

  #eventsRoute(student, allowedStudents) {
    return `/calendars/${assertStudent(student, narrowStudents(this.#allowedStudents, allowedStudents))}-calendar/events`;
  }

  async create(student, event) {
    return this.request('POST', this.#eventsRoute(student), event);
  }

  async patch(student, id, event) {
    return this.request('PATCH', `${this.#eventsRoute(student)}/${encodeURIComponent(id)}`, event);
  }

  async remove(student, id) {
    return this.request('DELETE', `${this.#eventsRoute(student)}/${encodeURIComponent(id)}`, {});
  }
}
