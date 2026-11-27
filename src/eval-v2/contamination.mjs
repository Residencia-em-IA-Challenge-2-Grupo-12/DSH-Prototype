import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { checkLookupPreload, containsWords, normalizeWords } from './preload.mjs';

const execFileAsync = promisify(execFile);
const result = findings => ({ clean: findings.length === 0, findings });
const secretKeys = /^(?:case_?id|canary_?guid|oracle|operator_?facts|forbidden_?secrets|hidden_?(?:oracle_?)?facts|oracle_?expectations|expected_?outcome)$/i;
const judgeKeys = /^(?:arm|engine|model|harness|student|case_?id)$/i;
const sensitiveFiles = /^(?:\.env(?:$|\.)|\.envrc$|\.npmrc$|\.git-credentials$|\.netrc$|id_(?:rsa|ed25519)$)|\.(?:pem|key|p12)$/i;
const excludedDirectories = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.study-atlas-sealed-eval']);
const gather = (value, onKey, onText, field) => {
  if (typeof value === 'string') onText(value, field);
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      onKey(key);
      gather(nested, onKey, onText, key);
    }
  }
};

export function hiddenMarkers(bundle) {
  return [bundle.canaryGuid, ...(bundle.split === 'sealed' ? [bundle.caseId] : []),
    ...bundle.operatorFacts.forbiddenSecrets, ...bundle.operatorFacts.hiddenOracleFacts];
}

function matchesMarker(text, marker) {
  return Boolean(marker) && (text.toLowerCase().includes(marker.toLowerCase()) || containsWords(text, marker));
}

export function checkRunnerPayload({ bundle, payload, prompts, tools, outputs }) {
  const findings = new Set();
  const markers = hiddenMarkers(bundle);
  gather({ payload, prompts, tools, outputs }, key => {
    if (secretKeys.test(key)) findings.add('runner_private_field');
  }, text => {
    if (markers.some(marker => matchesMarker(text, marker))) findings.add('runner_private_value');
    if (/"(?:case_?id|canary_?guid|oracle|operator_?facts|forbidden_?secrets|hidden_?(?:oracle_?)?facts|oracle_?expectations|expected_?outcome)"\s*:/i.test(text)) {
      findings.add('runner_private_field');
    }
  });
  return result([...findings]);
}

export function checkJudgePacket(packet, identifiers = []) {
  const findings = new Set();
  const banned = ['H0', 'C1', 'C3', 'arm', 'model', 'harness', 'engine', 'student', 'caseId', ...identifiers];
  gather(packet, key => {
    if (judgeKeys.test(key) || secretKeys.test(key)) findings.add('judge_private_field');
  }, (text, field) => {
    if (field === 'role' && ['assistant', 'user'].includes(text)) return;
    if (banned.some(value => containsWords(text, value))) findings.add('judge_private_value');
  });
  return result([...findings]);
}

export function detectRunnerPlannerCopy(source) {
  const name = /\b(?:simulate_[\w]+|simulate(?:Plan|Schedule|Week|Slots)|(?:plan|schedule|allocat\w*|assign)_(?:study_|weekly_)?(?:slots|blocks)|planScheduleDetails|placeWeekBlocks)\s*\(/i;
  const loops = /(?:\b(?:for|while)\s*\(|^\s*(?:for|while)\b|\.(?:map|reduce|forEach)\s*\()/m;
  const scheduling = /\b(?:studyWindows|weekCandidates|dailyCap|scheduleSlots|slotCandidates|availableSlots|timeSlots|study_windows|time_slots)\b/i;
  const placement = /\b(?:overlap\w*|allocat\w*|place\w*|append\s*\(|\.push\s*\()/i;
  return name.test(source) || (loops.test(source) && scheduling.test(source) && placement.test(source));
}

const windows = value => {
  const words = normalizeWords(value).split(' ');
  return Array.from({ length: Math.max(0, words.length - 5) }, (_, index) => words.slice(index, index + 6).join(' '));
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readWorkspaceFile = async (directory, relative) => {
  const file = path.join(directory, relative);
  if (sensitiveFiles.test(path.basename(file)) || await realpath(file) !== file || !(await lstat(file)).isFile()) {
    throw new Error('Unsafe workspace input for contamination scan');
  }
  const bytes = await readFile(file);
  const body = /\.pdf$/i.test(file) ? (await execFileAsync('pdftotext', ['-layout', file, '-'], {
    timeout: 15_000, maxBuffer: 5_000_000, env: { PATH: process.env.PATH, LC_ALL: 'C' },
  })).stdout : bytes.toString('utf8');
  return { relative, body, sha256: hash(bytes) };
};

function parsePhrases(bundle, workspace) {
  const values = [bundle.initialRequest, bundle.frictionMove, ...Object.values(bundle.operatorFacts.disclosable),
    ...bundle.operatorFacts.forbiddenSecrets, ...bundle.operatorFacts.hiddenOracleFacts,
    ...(bundle.oracle.pdfLookupTarget?.answerTokens ?? []), ...bundle.oracle.forbiddenInjectionPatterns,
    ...workspace.flatMap(file => [file.body, ...file.body.split(/\n|\f/).filter(line => normalizeWords(line).split(' ').length >= 6)]),
    ...bundle.calendarFixture.events.flatMap(event => [event.summary, event.description, event.location])
      .filter(value => value && normalizeWords(value).split(' ').length >= 6)];
  return [...new Set(values.map(normalizeWords).filter(Boolean))];
}

async function* repoFiles(directory, root = directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !excludedDirectories.has(entry.name)) yield* repoFiles(file, root);
    if (!entry.isFile() || sensitiveFiles.test(entry.name)) continue;
    const relative = path.relative(root, file);
    const bytes = await readFile(file);
    let body = bytes.includes(0) ? '' : bytes.toString('utf8');
    if (/\.pdf$/i.test(relative)) {
      // Keep scanning other files if an archived PDF is malformed, but surface
      // the coverage gap so a scan cannot silently certify an unreadable source.
      try { body = (await readWorkspaceFile(root, relative)).body; }
      catch { yield { relative, unreadable: true, sha256: hash(bytes), raw: bytes }; continue; }
    }
    yield { relative, body, sha256: hash(bytes), raw: bytes };
  }
}

const runnerSource = /(?:^|\/)(?:src\/runners\/|scripts\/[^/]*runner[^/]*\.(?:mjs|js|ts|py)$|(?:runner|pipeline[^/]*|verifier)\.(?:mjs|js|ts|py)$)/i;
const dates = iso => {
  const [year, month, day] = iso.split('-');
  const monthName = locale => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(iso));
  return [iso, `${day}/${month}/${year}`, `${month}/${day}/${year}`,
    `${monthName('en')} ${Number(day)} ${year}`, `${Number(day)} ${monthName('en')} ${year}`,
    `${Number(day)} de ${monthName('pt-BR')} de ${year}`];
};

export async function scanContamination({
  bundles = [], repoPath, peerRepoPath, gitLogText, runnerPrompts = [], toolSchemas = [], runnerOutputs = [],
  runnerPayloads = [], judgePackets = [], preloads = [],
} = {}) {
  const findings = [];
  const add = (kind, location) => findings.push({ kind, location });
  const sealed = bundles.filter(bundle => bundle.split === 'sealed');
  const indicators = await Promise.all(sealed.map(async bundle => {
    const workspace = await Promise.all(bundle.workspaceFiles.map(file => readWorkspaceFile(bundle.workspaceDir, file)));
    const phrases = parsePhrases(bundle, workspace);
    return {
      bundle,
      workspace,
      phrases,
      grams: new Set(phrases.flatMap(windows)),
      dates: bundle.oracle.requiredDeadlines.flatMap(deadline => {
        const names = [deadline.course, bundle.student, bundle.calendarFixture.users[0].name];
        return names.map(name => [name, dates(deadline.date)]);
      }),
    };
  }));
  function scanStatic({ relative, body = '', sha256, raw, unreadable }, allPhrases) {
    if (unreadable) add('unreadable_pdf', relative);
    if (runnerSource.test(relative) && detectRunnerPlannerCopy(body)) add('runner_planner_copy', relative);
    const source = `${relative}\n${body}`;
    const normalized = normalizeWords(source);
    const grams = allPhrases && indicators.length ? windows(normalized) : [];
    for (const indicator of indicators) {
      const { bundle, workspace, phrases, dates: combinations } = indicator;
      const contains = value => Boolean(value) && ` ${normalized} `.includes(` ${normalizeWords(value)} `);
      if (source.toLowerCase().includes(bundle.canaryGuid.toLowerCase()) || raw?.includes(bundle.canaryGuid)) add('sealed_canary', relative);
      if (allPhrases && phrases.some(contains)) add('sealed_exact_overlap', relative);
      if (allPhrases && grams.some(gram => indicator.grams.has(gram))) add('sealed_six_word_overlap', relative);
      if (allPhrases && combinations.some(([name, choices]) => contains(name) && choices.some(contains))) {
        add('sealed_name_and_date', relative);
      }
      if (allPhrases && workspace.some(file => source.toLowerCase().includes(file.relative.toLowerCase()))) {
        add('sealed_file_path', relative);
      }
      if (workspace.some(file => file.sha256 === sha256 || source.toLowerCase().includes(file.sha256) || raw?.includes(file.sha256))) {
        add('sealed_content_hash', relative);
      }
    }
  }

  for (const [label, directory] of [['repo', repoPath], ['peer', peerRepoPath]]) {
    if (!directory) continue;
    const root = await realpath(directory);
    if (sealed.some(bundle => bundle.workspaceDir === root || bundle.workspaceDir.startsWith(root + path.sep))) {
      add('sealed_workspace_inside_scan_root', label);
      continue;
    }
    for await (const file of repoFiles(root)) scanStatic({ ...file, relative: `${label}/${file.relative}` }, true);
  }
  if (gitLogText) scanStatic({ relative: 'git-log', body: gitLogText }, true);
  for (const [label, items] of [['runner-prompt', runnerPrompts], ['tool-schema', toolSchemas], ['runner-output', runnerOutputs]]) {
    items.forEach((item, index) => scanStatic({ relative: `${label}/${index}`, body: JSON.stringify(item) }, label !== 'runner-output'));
  }
  for (const [index, { bundle, payload, prompts, tools, outputs }] of runnerPayloads.entries()) {
    for (const kind of checkRunnerPayload({ bundle, payload, prompts, tools, outputs }).findings) add(kind, `runner-payload/${index}`);
  }
  for (const [index, { packet, identifiers }] of judgePackets.entries()) {
    for (const kind of checkJudgePacket(packet, identifiers).findings) add(kind, `judge-packet/${index}`);
  }
  for (const [index, { packet, bundle }] of preloads.entries()) {
    for (const kind of checkLookupPreload(packet, bundle.oracle.pdfLookupTarget).findings) add(kind, `preload/${index}`);
  }
  return result(findings.filter((finding, index) => findings.findIndex(item =>
    item.kind === finding.kind && item.location === finding.location) === index));
}
