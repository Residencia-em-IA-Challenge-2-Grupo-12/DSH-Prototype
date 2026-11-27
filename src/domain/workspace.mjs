import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT, assertStudent, readJSON, requiresStagedWorkspace, runtimeDir } from './runtime.mjs';

const execFileAsync = promisify(execFile);
const MAX_PDF_BYTES = 2_000_000;
const MAX_PDF_PAGE = 500;
const MAX_PDF_RANGE = 3;
const pdfProcessOptions = { timeout: 10_000, maxBuffer: 512 * 1024 };

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

export async function workspaceRoot(student, options = {}) {
  const { requireStaged, allowedStudents } = typeof options === 'boolean' ? { requireStaged: options } : options;
  assertStudent(student, allowedStudents);
  const staged = path.join(runtimeDir(), 'workspaces', student);
  if (requiresStagedWorkspace(requireStaged)) {
    for (const directory of [path.dirname(staged), staged]) {
      const entry = await fs.lstat(directory).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (!entry?.isDirectory()) throw new Error('Synthetic run workspace is unavailable');
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

export async function getStudent(student, options = {}) {
  const root = await workspaceRoot(student, options);
  const data = await readJSON(await checkedPath(root, 'courses.json'));
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

export async function listWorkspace(student, relative = '', options = {}) {
  const root = await workspaceRoot(student, options);
  const target = await checkedPath(root, relative);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries
    .filter(entry => !entry.isSymbolicLink())
    .map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }));
}

export async function readWorkspace(student, relative, { allowWholePdf = true, ...options } = {}) {
  const root = await workspaceRoot(student, options);
  const filePath = await checkedPath(root, relative);
  const ext = path.extname(filePath).toLowerCase();
  if (!['.md', '.json', '.txt', '.pdf'].includes(ext)) throw new Error('Unsupported synthetic file type');
  if (ext === '.pdf' && !allowWholePdf) {
    throw new Error('PDF reads in eval-v2 require an explicit bounded pageStart and pageEnd');
  }
  const info = await fs.stat(filePath);
  if (!info.isFile()) throw new Error('Expected a synthetic file');
  if (info.size > 200_000) throw new Error('File too large');
  if (ext === '.pdf') {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'], { timeout: 5000, maxBuffer: 500_000 });
    return stdout;
  }
  return fs.readFile(filePath, 'utf8');
}

async function pdfPath(student, relative, { maxBytes = MAX_PDF_BYTES, ...options }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PDF_BYTES) throw new Error('Invalid PDF byte limit');
  const filePath = await checkedPath(await workspaceRoot(student, options), relative);
  const info = await fs.stat(filePath);
  if (path.extname(filePath).toLowerCase() !== '.pdf' || !info.isFile()) throw new Error('Expected a synthetic PDF');
  if (info.size > maxBytes) throw new Error('PDF file too large');
  return filePath;
}

async function runPdfUtility(command, args) {
  try {
    return (await execFileAsync(command, args, {
      ...pdfProcessOptions,
      env: { PATH: process.env.PATH, LC_ALL: 'C' },
    })).stdout;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`PDF support requires ${command} from Poppler`);
    throw new Error(`${command} could not read the synthetic PDF within its limits`);
  }
}

async function pdfPageCount(filePath) {
  const output = await runPdfUtility('pdfinfo', [filePath]);
  const match = /^Pages:\s+(\d+)\s*$/m.exec(output);
  const count = Number(match?.[1]);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('PDF page count is unavailable');
  return count;
}

export async function inspectPdf(student, relative, options = {}) {
  const pageCount = await pdfPageCount(await pdfPath(student, relative, options));
  const pagesIndex = Array.from({ length: Math.min(pageCount, MAX_PDF_PAGE) }, (_, index) => index + 1);
  return { pageCount, pagesIndex };
}

export async function readWorkspacePageRange(student, relative, {
  pageStart, pageEnd, maxPages = MAX_PDF_RANGE, ...options
} = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PDF_RANGE ||
      !Number.isSafeInteger(pageStart) || !Number.isSafeInteger(pageEnd) ||
      pageStart < 1 || pageEnd < pageStart || pageEnd > MAX_PDF_PAGE || pageEnd - pageStart + 1 > maxPages) {
    throw new Error('PDF page range must select at most three pages between 1 and 500');
  }
  const filePath = await pdfPath(student, relative, options);
  const totalPages = await pdfPageCount(filePath);
  if (pageEnd > totalPages) throw new Error('PDF page range exceeds the document page count');
  const output = await runPdfUtility('pdftotext', ['-layout', '-f', String(pageStart), '-l', String(pageEnd), filePath, '-']);
  const text = output.split('\f');
  if (text.pop() !== '' || text.length !== pageEnd - pageStart + 1) throw new Error('PDF text did not preserve page boundaries');
  return { path: relative, pageStart, pageEnd, totalPages, pages: text.map((body, index) => ({ page: pageStart + index, text: body })) };
}
