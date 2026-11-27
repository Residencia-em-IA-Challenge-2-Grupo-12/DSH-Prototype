import http from 'node:http';
import { createEvalSession } from './eval-session.mjs';
import { createSingleAgentSession } from './agent-loop.mjs';
import { SCHEMA_COMPAT_MODES } from './tool-definitions.mjs';
import { assertTransport, EVAL_EVALUATOR_ORIGIN, EVAL_RUNNER_ORIGIN, syntheticHttpUrl } from '../../foundation/eval-transport.mjs';

const REASONING_EFFORT_LEVELS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

async function readJsonBody(req, limit = 512_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error('Request body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

/**
 * Standard OpenAI-compatible `/chat/completions` client.
 * Works against a loopback OpenAI-compatible endpoint or the fixed evaluator gateway.
 */
export function createOpenAICompatibleCompleter({
  baseUrl,
  apiKey,
  headers = {},
  reasoningEffort,
  timeoutMs = 120_000,
  fetchImpl = fetch,
  transport = 'loopback',
} = {}) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('baseUrl is required');
  if (reasoningEffort !== undefined && !REASONING_EFFORT_LEVELS.has(reasoningEffort)) {
    throw new Error(`Unsupported reasoningEffort: ${reasoningEffort} (expected one of ${[...REASONING_EFFORT_LEVELS].join(', ')})`);
  }
  const base = syntheticHttpUrl(baseUrl, {
    transport, peer: EVAL_EVALUATOR_ORIGIN,
    routes: transport === 'compose-eval' ? ['/v1', '/v1/gemini'] : undefined,
    message: 'Model gateway must be a loopback HTTP or explicit Compose chat endpoint',
  });
  const endpoint = `${base.href.replace(/\/+$/, '')}/chat/completions`;
  return async function completeChat({ model, messages, tools, max_tokens, response_format }) {
    const requestBody = {
      model,
      messages,
      tools,
      max_tokens,
      stream: false,
      ...(response_format ? { response_format } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        ...headers,
      },
      body: JSON.stringify(requestBody),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Chat completions failed (${response.status}): ${text.slice(0, 300)}`);
    return JSON.parse(text);
  };
}

/**
 * Standalone loopback HTTP server exposing `http-runner-v1` backed by the
 * harness-free single-agent tool loop.
 */
export async function startSingleAgentServer({
  host = '127.0.0.1',
  port = 0,
  completeChat,
  completeChatForRun,
  model = 'unspecified-model',
  revision = '1',
  mode = 'live',
  harness = 'single-agent-http-v1',
  engineName,
  maxSteps = 24,
  schemaCompat = 'standard',
  transport = 'loopback',
  schemaProfile = transport === 'compose-eval' ? 'eval-v2' : 'v1',
  onEvent,
} = {}) {
  assertTransport(transport);
  const composeBind = transport === 'compose-eval' && host === '0.0.0.0' && port === 4180;
  if (!composeBind && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('Single-agent HTTP runner must bind to loopback or the explicit Compose socket');
  }
  if (typeof completeChat !== 'function' && !(transport === 'compose-eval' && typeof completeChatForRun === 'function')) {
    throw new Error('completeChat function is required');
  }
  if (!SCHEMA_COMPAT_MODES.includes(schemaCompat)) {
    throw new Error(`Unsupported schemaCompat mode: ${schemaCompat} (expected one of ${SCHEMA_COMPAT_MODES.join(', ')})`);
  }

  const sessions = new Map();
  const server = http.createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const parts = url.pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, { ok: true, harness, model, mode, schemaCompat });
      }
      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'sessions') {
        const body = await readJsonBody(req);
        let complete = completeChat;
        if (transport === 'compose-eval' && completeChatForRun) {
          if (typeof body.runnerToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.runnerToken)) throw new Error('A per-run model gateway token is required');
          complete = completeChatForRun(body.runnerToken);
        }
        const shared = {
          student: body.student, locale: body.locale || 'en', clock: body.clock,
          toolBridge: body.toolBridge, completeChat: complete, model, schemaCompat, transport,
        };
        const session = body.sessionProfile === 'eval-v2'
          ? createEvalSession({ ...shared, mode: body.mode, preload: body.preload })
          : createSingleAgentSession({ ...shared, maxSteps, schemaProfile, onEvent });
        sessions.set(session.sessionId, session);
        return send(200, {
          sessionId: session.sessionId,
          ...(body.sessionProfile === 'eval-v2' ? { schemaCompat } : {}),
          engine: {
            name: engineName || `Single-agent HTTP (${model})`,
            revision,
            mode,
            model,
            harness,
          },
          usage: { availability: 'unknown' },
        });
      }
      if (parts[0] === 'sessions' && parts.length >= 2) {
        const sessionId = decodeURIComponent(parts[1]);
        const session = sessions.get(sessionId);
        if (!session) return send(404, { error: 'Session not found' });

        if (req.method === 'DELETE' && parts.length === 2) {
          sessions.delete(sessionId);
          return send(200, {});
        }
        if (req.method === 'GET' && parts.length === 3 && parts[2] === 'snapshot') {
          return send(200, session.snapshot());
        }
        if (req.method === 'POST' && parts.length === 3 && parts[2] === 'prompt') {
          const body = await readJsonBody(req);
          return send(200, await session.prompt(body.text));
        }
        if (req.method === 'POST' && parts.length === 3 && parts[2] === 'answer') {
          const body = await readJsonBody(req);
          return send(200, await session.answer(body.requestId, body.answers));
        }
        if (req.method === 'POST' && parts.length === 3 && parts[2] === 'cancel-question') {
          const body = await readJsonBody(req);
          return send(200, await session.cancelQuestion(body.requestId));
        }
      }
      return send(404, { error: 'Unknown runner endpoint' });
    } catch (error) {
      return send(400, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host === '[::1]' ? '::1' : host, resolve);
  });
  const address = server.address();
  const baseUrl = composeBind ? EVAL_RUNNER_ORIGIN : `http://${host === '::1' ? '[::1]' : host}:${address.port}`;
  return {
    url: baseUrl,
    port: address.port,
    close: () => new Promise(resolve => {
      sessions.clear();
      server.close(() => resolve());
    }),
  };
}
