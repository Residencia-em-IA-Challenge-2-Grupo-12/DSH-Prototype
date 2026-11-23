import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT, assertStudent, readJSON, runtimeDir } from './runtime.mjs';

const execFileAsync = promisify(execFile);

export async function checkedPath(root, relative) {
  const resolvedRoot = await fs.realpath(root);
  const lexical = path.resolve(resolvedRoot, relative || '.');
  if (lexical !== resolvedRoot && !lexical.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Path is outside synthetic workspace');
  }
  const candidate = await fs.realpath(lexical);
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Path is outside synthetic workspace');
  }
  return candidate;
}

export async function workspaceRoot(student, requireStaged = false) {
  assertStudent(student);
  const staged = path.join(runtimeDir(), 'workspaces', student);
  if (requireStaged) {
    for (const directory of [path.dirname(staged), staged]) {
      const entry = await fs.lstat(directory);
      if (!entry.isDirectory()) throw new Error('Synthetic run workspace is unavailable');
    }
    return staged;
  }
  try {
    await fs.access(staged);
    return staged;
  } catch {
    return path.join(ROOT, 'fixtures/students', student);
  }
}

export async function getStudent(student, { requireStaged = false } = {}) {
  const root = await workspaceRoot(student, requireStaged);
  const data = await readJSON(path.join(root, 'courses.json'));
  for (const course of data.courses) {
    const text = await fs.readFile(await checkedPath(root, course.source), 'utf8');
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const br = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    const date = iso?.[1] || (br ? `${br[3]}-${br[2]}-${br[1]}` : null);
    const time = text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
    if (date) course.deadline = `${date}T${time ? time[0] : '18:00'}:00-03:00`;
    else course.deadlineSourceWarning = 'No recognizable date; using fixture index as an assumption.';
  }
  return data;
}

export async function listWorkspace(student, relative = '', { requireStaged = false } = {}) {
  const root = await workspaceRoot(student, requireStaged);
  const target = await checkedPath(root, relative);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries
    .filter(entry => !entry.isSymbolicLink())
    .map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }));
}

export async function readWorkspace(student, relative, { requireStaged = false } = {}) {
  const root = await workspaceRoot(student, requireStaged);
  const filePath = await checkedPath(root, relative);
  const ext = path.extname(filePath).toLowerCase();
  if (!['.md', '.json', '.txt', '.pdf'].includes(ext)) throw new Error('Unsupported synthetic file type');
  const info = await fs.stat(filePath);
  if (info.size > 200_000) throw new Error('File too large');
  if (ext === '.pdf') {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'], { timeout: 5000, maxBuffer: 500_000 });
    return stdout;
  }
  return fs.readFile(filePath, 'utf8');
}
