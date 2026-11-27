import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { validateSourceCitation } from '../cold-start-context.mjs';
import { startTrustedToolBridge } from '../paired-replay/http-adapter.mjs';
import { buildOpenAITools } from '../runners/single-agent/tool-definitions.mjs';
import { createOpenAICompatibleCompleter } from '../runners/single-agent/server.mjs';
import { candidateSchema, EVAL_TOOL_METHODS, EVAL_MODES, createEvalSession } from '../runners/single-agent/eval-session.mjs';
import { EVAL_RUNNER_ORIGIN, syntheticHttpUrl } from '../foundation/eval-transport.mjs';
import { checkRunnerPayload } from './contamination.mjs';

export const ARMS = Object.freeze(['H0', 'C1', 'C3']);
const page = z.number().int().min(1).max(500);
const pathArg = z.string().min(1).max(180);
const citationArguments = z.strictObject({ citation: z.strictObject({ path: pathArg, page, quote: z.string().trim().min(8).max(450) }) });
const toolSchemas = {
  list_synthetic_files: z.strictObject({ path: pathArg.optional() }),
  list_calendar: z.strictObject({}),
  read_synthetic_file: z.strictObject({ path: pathArg, pageStart: page.optional(), pageEnd: page.optional() }),
  preview_plan: candidateSchema,
  propose_planning_context: candidateSchema.pick({ record: true }),
};

export function createArmBridge(service, student, arm, { inspect, disclosedSources } = {}) {
  if (!ARMS.includes(arm)) throw new Error('Unknown challenger');
  const allowed = EVAL_TOOL_METHODS.filter(method => arm === 'C3' || method === 'preview_plan' ||
    method === 'propose_planning_context' || (method === 'read_synthetic_file' && arm === 'C1'));
  const allowedMethods = [...allowed, 'verify_source_citation'];
  const planningRecords = [];
  const reads = [];
  let previews = [];
  let submission;
  let lookupAttempts = 0;
  let invalidCitation = false;
  return {
    planningRecords,
    reads,
    beginTurn() {
      previews = [];
      submission = null;
      lookupAttempts = 0;
      invalidCitation = false;
    },
    get invalidCitation() { return invalidCitation; },
    get submission() { return submission; },
    get previews() { return structuredClone(previews); },
    service: {
      agent: {
        allowedMethods: () => [...allowedMethods],
        async call(method, { student: requestedStudent, ...input }) {
          if (!allowedMethods.includes(method) || requestedStudent !== student) throw new Error('Agent operation is not available');
          inspect?.({ outputs: input });
          if (method === 'verify_source_citation') {
            invalidCitation = true;
            const { citation } = citationArguments.parse(input);
            await validateSourceCitation(citation, null, disclosedSources);
            invalidCitation = false;
            return { verified: true };
          }
          if (method === 'propose_planning_context' || method === 'preview_plan') {
            planningRecords.push(structuredClone(input.record ?? input));
          }
          if (method === 'read_synthetic_file' && arm === 'C1' && ++lookupAttempts > 1) {
            throw new Error('Only one bounded lookup is available');
          }
          const args = toolSchemas[method].parse(input);
          if (method === 'read_synthetic_file') {
            const { path, pageStart, pageEnd } = args;
            if ((arm === 'C1' || /\.pdf$/i.test(path)) &&
                (!/\.pdf$/i.test(path) || pageStart === undefined || pageEnd === undefined ||
                  pageEnd < pageStart || pageEnd - pageStart >= 3)) {
              throw new Error('Select at most three pages of one PDF');
            }
          }
          const prior = method === 'propose_planning_context'
            ? previews.findLast(item => isDeepStrictEqual(item.record, args.record))
            : null;
          if (method === 'propose_planning_context' && !prior) throw new Error('Preview this candidate before proposing it');
          const result = await service.agent.call(method, { ...args, student });
          if (method === 'preview_plan') {
            const { record, ...options } = args;
            previews.push({ record, options, result });
            // Return only planning diagnostics and reviewable quantities. IDs,
            // timestamps, hashes and internal state never enter the model history.
            const blocks = events => events.map(event => ({ course: event.extendedProperties.private.course,
              start: event.start.dateTime, end: event.end.dateTime }));
            const view = { ok: result.ok, horizon: result.horizon, capacityPerWeek: result.capacityPerWeek,
              findings: result.findings, outlook: result.plan.outlook,
              near: blocks(result.plan.near), tentative: blocks(result.plan.future) };
            inspect?.({ outputs: view });
            return view;
          }
          if (prior) {
            submission = { ...prior, id: result.id };
            return { pendingReview: true };
          }
          inspect?.({ outputs: result });
          if (method === 'read_synthetic_file') {
            reads.push({ ...args, pages: Array.isArray(result?.pages) ? result.pages.map(item => item.page) : [] });
          }
          return result;
        },
      },
    },
  };
}

export async function startArmSession({
  arm, bundle, bridge, preload, model, completeChat, gateway, runnerUrl,
  transport = 'loopback', schemaCompat = 'standard', fetchImpl = fetch, inspect,
}) {
  const mode = EVAL_MODES[ARMS.indexOf(arm)];
  if (!mode) throw new Error('Unknown challenger');
  const { student, locale, clock } = bundle;
  const common = { student, locale, clock, mode, preload: preload.bytes };
  const check = (payload, tools) => {
    if (inspect) return inspect({ payload, tools });
    if (!checkRunnerPayload({ bundle, payload, tools }).clean) {
      throw Object.assign(new Error('Runner payload failed contamination checks'), { code: 'runner_contamination' });
    }
  };
  check(common, buildOpenAITools(EVAL_TOOL_METHODS, { schemaProfile: 'eval-v2', schemaCompat, previewCandidateRequired: true }));
  if (!runnerUrl) {
    const complete = completeChat ?? (gateway && createOpenAICompatibleCompleter({
      baseUrl: gateway.chatBaseUrl, apiKey: gateway.runnerToken, transport, fetchImpl,
      reasoningEffort: gateway.reasoningEffort,
    }));
    return {
      ...createEvalSession({
        ...common, completeChat: complete && (request => {
          check(request.messages, request.tools);
          return complete(request);
        }),
        model, schemaCompat,
        async bridgeCall(method, args) {
          try { return { isError: false, result: await bridge.service.agent.call(method, { ...args, student }) }; }
          catch (error) { return { isError: true, error: error.message }; }
        },
      }),
      close: async () => {},
    };
  }
  const runner = syntheticHttpUrl(runnerUrl, {
    transport, peer: EVAL_RUNNER_ORIGIN, routes: ['/'], message: 'Invalid Eval v2 runner URL',
  });
  if (gateway?.runnerToken && (transport !== 'compose-eval' || runner.origin !== EVAL_RUNNER_ORIGIN)) {
    throw new Error('Gateway runner credentials require the fixed Compose runner');
  }
  const toolBridge = await startTrustedToolBridge({
    student, service: bridge.service, transport, mountToolBridge: gateway?.mountToolBridge,
  });
  const request = async (method, route, data) => {
    const response = await fetchImpl(runner.origin + route, {
      method,
      ...(data === undefined ? {} : {
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
      }),
      redirect: 'error', signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Runner endpoint returned HTTP ${response.status}`);
    }
    return response.json();
  };
  let sessionId;
  try {
    const body = { ...common, version: 1, runId: randomUUID(), sessionProfile: 'eval-v2',
      ...(gateway?.runnerToken ? { runnerToken: gateway.runnerToken } : {}),
      toolBridge: { url: toolBridge.url, token: toolBridge.token, methods: bridge.service.agent.allowedMethods() } };
    check(body);
    const started = await request('POST', '/sessions', body);
    sessionId = z.string().regex(/^[\w.-]{1,128}$/).parse(started.sessionId);
    if (started.engine?.model !== model || started.schemaCompat !== schemaCompat) {
      throw Object.assign(new Error('The runner differs from the frozen model or schema mode'), { code: 'runner_pin_mismatch' });
    }
  } catch (error) {
    try { if (sessionId) await request('DELETE', `/sessions/${encodeURIComponent(sessionId)}`); }
    finally { await toolBridge.close(); }
    throw error;
  }
  const route = `/sessions/${encodeURIComponent(sessionId)}`;
  const send = (action, data) => {
    check(data);
    return request('POST', `${route}/${action}`, data);
  };
  return {
    sessionId,
    snapshot: () => request('GET', route + '/snapshot'),
    prompt: text => send('prompt', { text }),
    answer: (requestId, answers) => send('answer', { requestId, answers }),
    cancelQuestion: requestId => send('cancel-question', { requestId }),
    async close() {
      try { await request('DELETE', route); }
      finally { await toolBridge.close(); }
    },
  };
}
