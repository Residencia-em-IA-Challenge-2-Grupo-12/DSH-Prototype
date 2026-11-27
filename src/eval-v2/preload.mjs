import { createHash } from 'node:crypto';
import { inspectPdf, readWorkspace, readWorkspacePageRange } from '../domain/workspace.mjs';

export const PRELOAD_VERSION = 'study-preload-v1';
const MAX_WORKSPACE_CHARS = 10_000;
const MAX_INDEXED_PAGES = 500;

export function normalizeWords(value) {
  return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

export function containsWords(text, phrase) {
  const needle = normalizeWords(phrase);
  return Boolean(needle) && ` ${normalizeWords(text)} `.includes(` ${needle} `);
}

export async function buildPreload({ bundle, agent, disclosedSources }) {
  const { student, workspaceFiles, preloadConfig } = bundle;
  const workspace = { allowedStudents: [student], requireStaged: true };
  const calendar = await agent.call('list_calendar', { student });
  calendar.events.sort((left, right) => left.id < right.id ? -1 : Number(left.id > right.id));
  const files = [];
  const pdfs = [];
  let remaining = MAX_WORKSPACE_CHARS;
  for (const file of workspaceFiles) {
    if (/\.pdf$/i.test(file)) {
      const { pageCount, pagesIndex } = await inspectPdf(student, file, workspace);
      const count = Math.min(preloadConfig.maxPdfPages, pageCount);
      const pages = [];
      if (count && remaining) {
        const result = await readWorkspacePageRange(student, file, {
          ...workspace, pageStart: 1, pageEnd: count, maxPages: count,
        });
        for (const { page, text } of result.pages) {
          if (!remaining) break;
          const excerpt = text.slice(0, Math.min(preloadConfig.maxTextChars, remaining));
          remaining -= excerpt.length;
          pages.push({ page, text: excerpt, truncated: excerpt.length < text.length });
        }
      }
      pdfs.push({ path: file, pageCount, pageIndex: { first: pagesIndex[0], last: Math.min(pageCount, MAX_INDEXED_PAGES) },
        pages });
      continue;
    }
    if (!remaining) continue;
    const text = await readWorkspace(student, file, workspace);
    const excerpt = text.slice(0, Math.min(preloadConfig.maxTextChars, remaining));
    remaining -= excerpt.length;
    files.push({ path: file, text: excerpt, truncated: excerpt.length < text.length });
  }
  const packet = { version: PRELOAD_VERSION, calendar, files, pdfs };
  const bytes = JSON.stringify(packet);
  for (const file of files) disclosedSources.disclose(file.path, file.text);
  for (const pdf of pdfs) {
    for (const page of pdf.pages) disclosedSources.disclose(pdf.path, page.text, page.page);
  }
  return { packet, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function checkLookupPreload(packet, target) {
  if (!target) return { clean: true, findings: [] };
  const findings = [];
  const pdf = packet.pdfs.find(file => file.path === target.path);
  if (!pdf || target.page > pdf.pageIndex.last) findings.push('target_page_unavailable');
  if (pdf?.pages.some(page => page.page === target.page)) findings.push('target_page_preloaded');
  // Walk decoded values so punctuation, line breaks and JSON escaping cannot
  // conceal a match in a table of contents, excerpt or calendar field.
  const collect = value => value && typeof value === 'object' ? Object.values(value).flatMap(collect) : [String(value ?? '')];
  const values = collect(packet);
  if (target.answerTokens.some(token => values.some(value => containsWords(value, token)))) findings.push('target_answer_preloaded');
  return { clean: findings.length === 0, findings };
}
