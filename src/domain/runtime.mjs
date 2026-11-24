import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStateStore } from '../state-store.mjs';

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
  return path.resolve(runtimeContext.getStore() || process.env.STUDY_ATLAS_RUNTIME_DIR || path.join(ROOT, '.runtime'));
}

export function withSyntheticRuntime(directory, operation) {
  if (
    typeof directory !== 'string' ||
    !path.isAbsolute(directory) ||
    path.normalize(directory) !== directory ||
    directory === path.parse(directory).root ||
    typeof operation !== 'function'
  ) {
    throw new Error('A valid synthetic runtime and operation are required');
  }
  return runtimeContext.run(directory, operation);
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

export function assertStudent(id, allowed = KNOWN_STUDENTS) {
  if (typeof id !== 'string' || !allowed.includes(id)) throw new Error('Unknown fixture');
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

export async function loadState(student) {
  return stateStore.load(assertStudent(student));
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
  constructor(base = process.env.CALENDARPIT_URL || 'http://127.0.0.1:4173') {
    const u = new URL(base);
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) {
      throw new Error('Calendarpit must be on loopback');
    }
    this.base = u.origin;
  }

  async request(method, route, body) {
    const res = await fetch(`${this.base}/__calendarpit${route}`, {
      method,
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

  async events(student) {
    return (await this.request('GET', `/calendars/${assertStudent(student)}-calendar/events`)).items;
  }

  async reset(student) {
    return this.request('POST', '/fixtures', await readJSON(path.join(ROOT, 'fixtures/calendars', `${assertStudent(student)}.json`)));
  }

  async create(student, event) {
    return this.request('POST', `/calendars/${assertStudent(student)}-calendar/events`, event);
  }

  async patch(student, id, event) {
    return this.request('PATCH', `/calendars/${assertStudent(student)}-calendar/events/${encodeURIComponent(id)}`, event);
  }

  async remove(student, id) {
    return this.request('DELETE', `/calendars/${assertStudent(student)}-calendar/events/${encodeURIComponent(id)}`, {});
  }
}
