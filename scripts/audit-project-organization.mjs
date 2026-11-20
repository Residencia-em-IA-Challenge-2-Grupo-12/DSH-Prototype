#!/usr/bin/env node
// Read-only maintenance check for the DSH Prototype GitHub project.
// This script intentionally has no GitHub write operations.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const DEFAULT_REPO = 'Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype';
const DEFAULT_OWNER = 'Residencia-em-IA-Challenge-2-Grupo-12';
const ACTIVE = new Set(['ready', 'in progress', 'in review']);
const EXPECTED_VIEWS = ['Prioritized backlog', 'Status board', 'Bugs', 'In review', 'My items'];

function argsOf(argv) {
  const out = { repo: DEFAULT_REPO, owner: DEFAULT_OWNER, project: '1' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--snapshot' || arg === '--repo' || arg === '--owner' || arg === '--project') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      const key = { '--snapshot': 'snapshot', '--repo': 'repo', '--owner': 'owner', '--project': 'project' }[arg];
      out[key] = argv[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

const help = `Usage: node scripts/audit-project-organization.mjs [options]

Read-only checks for open issue/PR organization and Project views.

  --snapshot PATH  Read a JSON aggregate file or a directory of raw gh snapshots
  --repo REPO      GitHub repository (default: ${DEFAULT_REPO})
  --owner OWNER    Project owner (default: ${DEFAULT_OWNER})
  --project N      Project number (default: 1)
  -h, --help       Show this help

Without --snapshot, uses read-only gh CLI commands and requires gh authentication.
Warnings are informational; the script never changes GitHub data.`;

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function snapshotFromPath(snapshotPath) {
  const info = await stat(snapshotPath);
  if (info.isFile()) {
    const data = await readJson(snapshotPath);
    if (Array.isArray(data.issues) || Array.isArray(data.pullRequests)) return normalizeData(data);
    // The versioned audit report preserves classification proposals and views,
    // but no raw issue bodies, labels or project item rows.
    return normalizeData({ views: data.currentViews, fields: data.singleSelectFields, viewDataAvailable: true });
  }
  const load = async (name) => {
    try { return await readJson(path.join(snapshotPath, name)); } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const [issues, prs, itemsDoc, viewsDoc, schemaViews, hierarchy, linked] = await Promise.all([
    load('issues.json'), load('prs.json'), load('items.json'), load('views-and-values.json'), load('schema-views.json'), load('hierarchy.json'),
    load('issue-pr-links.json'),
  ]);
  const items = Array.isArray(itemsDoc) ? itemsDoc : itemsDoc?.items;
  const viewRoot = viewsDoc?.data?.organization?.projectV2 ?? viewsDoc?.organization?.projectV2;
  const schemaRoot = schemaViews?.data?.organization?.projectV2 ?? schemaViews?.organization?.projectV2;
  return normalizeData({
    issues: Array.isArray(issues) ? issues : undefined,
    pullRequests: Array.isArray(prs) ? prs : undefined,
    items,
    views: viewRoot?.views?.nodes ?? schemaRoot?.views?.nodes,
    fields: viewRoot?.fields?.nodes ?? schemaRoot?.fields?.nodes,
    relations: hierarchy?.data?.repository,
    linkedPrByIssue: linked?.linkedPrByIssue ?? linked?.data?.repository?.issues?.nodes?.reduce((out, issue) => {
      out[issue.number] = (issue.timelineItems?.nodes ?? []).map((event) => event.source).filter((source) => source?.number);
      return out;
    }, {}),
    viewDataAvailable: Boolean(viewRoot || schemaRoot),
  });
}

async function ghJson(args) {
  const { stdout } = await execFileAsync('gh', args, { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });
  return JSON.parse(stdout);
}

async function liveData({ repo, owner, project }) {
  const viewQuery = `query($owner: String!, $number: Int!) { organization(login: $owner) { projectV2(number: $number) { views(first: 50) { nodes { name filter groupByFields(first: 20) { nodes { ... on ProjectV2FieldCommon { name } } } } } fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { name isIssueField options { name } } } } } } }`;
  const linkedQuery = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { issues(first: 100, states: OPEN) { nodes { number parent { number } subIssues(first: 100) { nodes { number } } timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT]) { nodes { ... on CrossReferencedEvent { source { ... on PullRequest { number url state } } } } } } } } }`;
  const [issues, pullRequests, itemsDoc, viewsDoc, linkedDoc] = await Promise.all([
    ghJson(['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '1000', '--json', 'number,title,body,labels,assignees,url']),
    ghJson(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '1000', '--json', 'number,title,body,labels,assignees,url,isDraft']),
    ghJson(['project', 'item-list', project, '--owner', owner, '--format', 'json', '--limit', '1000']),
    ghJson(['api', 'graphql', '-f', `query=${viewQuery}`, '-F', `owner=${owner}`, '-F', `number=${project}`]),
    ghJson(['api', 'graphql', '-f', `query=${linkedQuery}`, '-F', `owner=${owner}`, '-F', `name=${repo.split('/').at(-1)}`]).catch(() => undefined),
  ]);
  const projectItems = Array.isArray(itemsDoc) ? itemsDoc : itemsDoc.items;
  const projectData = viewsDoc.data?.organization?.projectV2;
  const projectViews = projectData?.views?.nodes;
  return normalizeData({
    issues, pullRequests, items: projectItems, views: projectViews,
    fields: projectData?.fields?.nodes,
    relations: linkedDoc?.data?.repository?.issues?.nodes?.reduce((out, issue) => { out[`n${issue.number}`] = issue; return out; }, {}),
    linkedPrByIssue: linkedDoc?.data?.repository?.issues?.nodes?.reduce((out, issue) => {
      out[issue.number] = (issue.timelineItems?.nodes ?? []).map((event) => event.source).filter((source) => source?.number);
      return out;
    }, {}),
    viewDataAvailable: Array.isArray(projectViews),
  });
}

function normalizeData(data) {
  return {
    issues: Array.isArray(data.issues) ? data.issues : undefined,
    pullRequests: Array.isArray(data.pullRequests) ? data.pullRequests : undefined,
    items: Array.isArray(data.items) ? data.items : undefined,
    views: Array.isArray(data.views) ? data.views : undefined,
    fields: Array.isArray(data.fields) ? data.fields : undefined,
    relations: data.relations,
    linkedPrByIssue: data.linkedPrByIssue,
    viewDataAvailable: data.viewDataAvailable ?? Array.isArray(data.views),
  };
}

function labelsOf(record) {
  return (record.labels ?? []).map((x) => typeof x === 'string' ? x : x.name).filter(Boolean);
}

function hasAcceptance(body) {
  return /acceptance|definition of done|success criteria|completion criteria|expected outcome|verification|deliverable/i.test(body ?? '');
}

function hasNextAction(body) {
  return /next action|next step|follow[- ]?up|remaining|todo|to do|\[ \]/i.test(body ?? '');
}

function hasContext(body) {
  return /purpose|why|context|background|scope|blocked by|depends on|prerequisite/i.test(body ?? '');
}

function projectRecords(items) {
  const byNumber = new Map();
  for (const item of items ?? []) {
    const content = item.content ?? item;
    const number = content.number ?? item.number;
    const type = content.type ?? item.type;
    if (number != null) byNumber.set(`${type === 'PullRequest' || type === 'Pull request' ? 'pr' : 'issue'}:${number}`, item);
  }
  return byNumber;
}

function statusOf(item) {
  const fields = item?.fieldValues?.nodes ?? item?.fieldValues ?? [];
  const statusField = fields.find?.((field) => (field.field?.name ?? field.name) === 'Status');
  return item?.status ?? statusField?.name ?? statusField?.option?.name ?? item?.status?.name ?? '';
}

function warn(message, list) { list.push(message); }

function audit(data) {
  const warnings = [];
  const notes = [];
  const issues = data.issues ?? [];
  const prs = data.pullRequests ?? [];
  const pItems = projectRecords(data.items);
  if (!data.issues) notes.push('Issue data unavailable; issue body/classification checks skipped.');
  if (!data.pullRequests) notes.push('Pull request data unavailable; PR classification checks skipped.');
  if (!data.items) notes.push('Project item/status data unavailable; active-work checks skipped.');

  const classify = (record, label) => {
    const names = labelsOf(record);
    const areas = names.filter((name) => name.startsWith('area:'));
    const kinds = names.filter((name) => name.startsWith('kind:'));
    const standardTypes = names.filter((name) => ['bug', 'enhancement', 'documentation'].includes(name.toLowerCase()));
    if (areas.length === 0) warn(`${label} has no primary area label.`, warnings);
    else if (areas.length > 1) warn(`${label} has multiple area labels (${areas.join(', ')}); confirm one primary area.`, warnings);
    if (kinds.length === 0 && standardTypes.length === 0) warn(`${label} has no work kind/type label.`, warnings);
  };
  for (const issue of issues) classify(issue, `Issue #${issue.number}`);
  for (const pr of prs) classify(pr, `PR #${pr.number}`);

  if (data.items && data.issues) {
    const issueByNumber = new Map(issues.map((issue) => [Number(issue.number), issue]));
    for (const [key, item] of pItems) {
      if (!key.startsWith('issue:')) continue;
      const number = Number(key.slice(6));
      const issue = issueByNumber.get(number) ?? (item.content?.body != null ? item.content : null);
      if (!issue) continue;
      const status = String(statusOf(item)).toLowerCase();
      if (!ACTIVE.has(status)) continue;
      const relation = data.relations?.[`n${number}`];
      const body = issue.body ?? '';
      const isEpic = labelsOf(issue).includes('kind:epic') || Boolean(relation?.subIssues?.nodes?.length) || /\b(epic|programme)\b/i.test(issue.title ?? '');
      const isLeaf = !isEpic;
      if (!relation) notes.push(`Issue #${number} hierarchy not captured; leaf classification is tentative (no missing relationship inferred).`);
      const actionable = hasAcceptance(body) || hasNextAction(body) || body.length >= 300 || /\[ \]/.test(body);
      if (isLeaf && actionable && !(issue.assignees ?? []).length && !/ownership[- ]gap/i.test(body)) {
        warn(`Issue #${number} is In progress/Ready/In review without an owner or explicit ownership-gap note.`, warnings);
      } else if (isLeaf && actionable && !(issue.assignees ?? []).length && /ownership[- ]gap/i.test(body)) {
        warn(`Issue #${number} records an ownership gap; resolve it before treating as owned active work.`, warnings);
      }
      if (isLeaf && actionable) {
        const missing = [];
        if (!hasAcceptance(body)) missing.push('clear acceptance/outcome');
        if (!hasNextAction(body)) missing.push('next action');
        if (!hasContext(body)) missing.push('purpose/context');
        if (missing.length) warn(`Issue #${number} active handoff may be missing ${missing.join(', ')}.`, warnings);
      }
    }
    if (data.linkedPrByIssue) {
      for (const [key, item] of pItems) {
        if (!key.startsWith('issue:')) continue;
        const number = Number(key.slice(6));
        const status = String(statusOf(item)).toLowerCase();
        const issue = issues.find((record) => Number(record.number) === number);
        const relation = data.relations?.[`n${number}`];
        const epic = labelsOf(issue ?? {}).includes('kind:epic') || Boolean(relation?.subIssues?.nodes?.length) || /\b(epic|programme)\b/i.test(issue?.title ?? '');
        const body = issue?.body ?? item.content?.body ?? '';
        if (ACTIVE.has(status) && !epic && (hasAcceptance(body) || hasNextAction(body) || body.length >= 300) && !(data.linkedPrByIssue[number] ?? []).length) {
          warn(`Issue #${number} has no linked PR reference in captured cross-reference events; confirm this is expected for its active stage.`, warnings);
        }
      }
    } else notes.push('PR-to-issue relationship data was not captured; missing active PR links are not inferred.');
  }

  if (!data.viewDataAvailable || !data.views) notes.push('Project view/filter data unavailable; view checks skipped.');
  else {
    const view = (name) => data.views.find((v) => {
      const actual = String(v.name ?? '').trim().toLowerCase();
      return name === 'Bugs' ? actual.startsWith('bugs') : actual === name.toLowerCase();
    });
    for (const name of EXPECTED_VIEWS) if (!view(name)) warn(`Expected Project view “${name}” was not found.`, warnings);
    const bugs = data.views.find((v) => String(v.name ?? '').trim().toLowerCase().startsWith('bugs'));
    if (bugs && !/label\s*:\s*bug/i.test(bugs.filter ?? '')) warn('Bugs view has no visible bug-label filter.', warnings);
    const backlog = view('Prioritized backlog');
    if (backlog) {
      if (!backlog.filter) warn('Prioritized backlog has no filter; confirm it excludes closed/done and non-actionable items.', warnings);
      const groups = (backlog.groupByFields?.nodes ?? backlog.groupByFields ?? []).map((x) => x.name);
      const sort = JSON.stringify(backlog.sortBy ?? backlog.sort ?? '').toLowerCase();
      if (![...groups, sort].some((name) => /priority/i.test(name))) warn('Prioritized backlog does not visibly group or sort by Priority.', warnings);
    }
    const priority = (data.fields ?? []).find((field) => field.name === 'Priority');
    if (priority?.isIssueField) notes.push('Priority is an organization issue field; empty Project options do not establish missing organization choices.');
    else if (priority && Array.isArray(priority.options) && priority.options.length === 0) warn('Priority field has no options.', warnings);
  }

  if (data.relations) notes.push('Native hierarchy/dependency data was captured; this check preserves it and does not prescribe missing edges.');
  else if (data.items) notes.push('Native hierarchy/dependency data was not captured; no absent parent/blocker relation is reported.');
  return { warnings, notes, counts: { issues: data.issues?.length ?? null, pullRequests: data.pullRequests?.length ?? null, projectItems: data.items?.length ?? null, views: data.views?.length ?? null } };
}

try {
  const options = argsOf(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${help}\n`); process.exit(0); }
  const data = options.snapshot ? await snapshotFromPath(options.snapshot) : await liveData(options);
  const result = audit(data);
  process.stdout.write(`Organization audit (read-only)\n${JSON.stringify(result.counts)}\n`);
  for (const message of result.warnings) process.stdout.write(`WARN ${message}\n`);
  for (const message of result.notes) process.stdout.write(`INFO ${message}\n`);
  process.stdout.write(`\n${result.warnings.length} warning(s), ${result.notes.length} note(s). Warnings require human review.\n`);
} catch (error) {
  process.stderr.write(`audit-project-organization: ${error.message}\n`);
  process.exitCode = 2;
}
