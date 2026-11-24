import http from 'node:http';
import { createSingleAgentSession } from './agent-loop.mjs';
import { SCHEMA_COMPAT_MODES } from './tool-definitions.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const REASONING_EFFORT_LEVELS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

function assertLoopbackHost(host) {
  if (!LOOPBACK_HOSTS.has(host)) throw new Error('Single-agent HTTP runner must bind to loopback only');
}

function assertLoopbackUrl(rawUrl, label) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label} must be loopback http://`);
  }
}

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
 * Works against `createOpenRouterGateway` (loopback), local Ollama/vLLM, or
 * any OpenAI-compatible API endpoint without depending on DSH.
 */
export function createOpenAICompatibleCompleter({
  baseUrl,
  apiKey,
  headers = {},
  reasoningEffort,
  timeoutMs = 120_000,
  fetchImpl = fetch,
} = {}) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('baseUrl is required');
  if (reasoningEffort !== undefined && !REASONING_EFFORT_LEVELS.has(reasoningEffort)) {
    throw new Error(`Unsupported reasoningEffort: ${reasoningEffort} (expected one of ${[...REASONING_EFFORT_LEVELS].join(', ')})`);
  }
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return async function completeChat({ model, messages, tools }) {
    const requestBody = {
      model,
      messages,
      tools,
      stream: false,
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
  model = 'unspecified-model',
  revision = '1',
  mode = 'live',
  harness = 'single-agent-http-v1',
  engineName,
  maxSteps = 12,
  schemaCompat = 'standard',
} = {}) {
  assertLoopbackHost(host);
  if (typeof completeChat !== 'function') throw new Error('completeChat function is required');
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
        assertLoopbackUrl(body?.toolBridge?.url, 'toolBridge.url');
        const session = createSingleAgentSession({
          student: body.student,
          locale: body.locale || 'en',
          clock: body.clock,
          toolBridge: body.toolBridge,
          completeChat,
          model,
          maxSteps,
          schemaCompat,
        });
        sessions.set(session.sessionId, session);
        return send(200, {
          sessionId: session.sessionId,
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
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const baseUrl = `http://${host}:${address.port}`;
  return {
    url: baseUrl,
    port: address.port,
    close: () => new Promise(resolve => {
      sessions.clear();
      server.close(() => resolve());
    }),
  };
}
