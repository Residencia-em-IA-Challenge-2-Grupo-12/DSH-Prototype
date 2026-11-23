import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { z } from 'zod';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const questionOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
});

const questionItemSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1).optional(),
  question: z.string().min(1),
  options: z.array(questionOptionSchema).default([]),
});

const snapshotSchema = z.object({
  messages: z.array(z.object({
    type: z.enum(['user', 'assistant', 'system']),
    text: z.string(),
  })).default([]),
  question: z.object({
    requestId: z.string().min(1),
    questions: z.array(questionItemSchema).min(1),
  }).nullable().default(null),
  busy: z.boolean().default(false),
  error: z.string().nullable().default(null),
});

const usageSchema = z.discriminatedUnion('availability', [
  z.strictObject({ availability: z.literal('unknown') }),
  z.strictObject({ availability: z.literal('not_applicable') }),
  z.strictObject({
    availability: z.literal('available'),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
]);

const sessionStartSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  engine: z.object({
    name: z.string().min(1).optional(),
    revision: z.string().min(1).optional(),
    mode: z.enum(['scripted', 'live']).optional(),
    model: z.string().min(1).nullable().optional(),
    harness: z.string().min(1).nullable().optional(),
  }).optional(),
  usage: usageSchema.optional(),
});

function assertLoopbackOrigin(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('External runner URL must be loopback http://');
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

async function readJsonBody(req, limit = 512_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error('Tool bridge request too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function tokenMatches(actual, expected) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Private per-run loopback HTTP bridge exposing ONLY `service.agent.call`
 * (backed by StudyBoundary). External runners (e.g. StudyBuddy FastAPI,
 * non-DSH single-agent loops, or delegation prototypes) can read staged
 * files/calendar and propose plans/context without ever gaining approval or
 * calendar-write access.
 */
export async function startTrustedToolBridge({ student, service }) {
  const token = randomBytes(24).toString('hex');
  const calledTools = new Set();
  const server = http.createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    try {
      if (req.method !== 'POST' || req.url !== '/tools/call') return send(404, { ok: false, error: 'Unknown tool bridge route' });
      if (!tokenMatches(req.headers['x-study-run-token'], token)) return send(401, { ok: false, error: 'Unauthorized tool bridge token' });
      const { method, args } = await readJsonBody(req);
      if (typeof method !== 'string' || !method) return send(400, { ok: false, error: 'Tool method is required' });
      if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
        return send(400, { ok: false, error: 'Tool args must be an object' });
      }
      const result = await service.agent.call(method, { ...(args || {}), student });
      calledTools.add(method);
      return send(200, { ok: true, result });
    } catch (error) {
      const forbidden = /not available|does not match|outside synthetic workspace/i.test(error.message);
      return send(forbidden ? 403 : 400, { ok: false, error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/tools/call`,
    token,
    calledTools: () => [...calledTools].sort(),
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

/**
 * Harness-agnostic loopback HTTP/JSON runner adapter for `runPortableReplay`.
 * Compatible with any language/stack (Python FastAPI StudyBuddy, Node non-DSH
 * tool loops, or runtime-defined delegating agents).
 */
export function createHttpRunnerAdapter({ url, engine = {}, timeoutMs = 30_000, draftRequest } = {}) {
  const base = assertLoopbackOrigin(url);
  async function request(method, route, body) {
    const response = await fetch(base + route, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`External runner ${response.status} on ${method} ${route}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }

  return {
    engine: {
      name: engine.name || 'External HTTP runner',
      revision: engine.revision,
      mode: engine.mode || 'scripted',
      model: engine.model ?? null,
      harness: engine.harness ?? 'http-runner-v1',
      tools: engine.tools || [],
    },
    draftRequest,
    async createSession({ bundle, service, runId }) {
      const { manifest } = bundle;
      const bridge = await startTrustedToolBridge({ student: manifest.student, service });
      let sessionId = null;
      let reportedEngine = {};
      let reportedUsage = null;
      try {
        const started = sessionStartSchema.parse(await request('POST', '/sessions', {
          version: 1,
          runId,
          caseId: manifest.id,
          student: manifest.student,
          locale: manifest.locale,
          clock: manifest.clock,
          sources: manifest.sources,
          toolBridge: {
            url: bridge.url,
            token: bridge.token,
            methods: typeof service.agent.allowedMethods === 'function' ? service.agent.allowedMethods() : [],
          },
        }));
        sessionId = started.sessionId;
        if (started.engine) reportedEngine = started.engine;
        if (started.usage) reportedUsage = started.usage;
      } catch (error) {
        await bridge.close();
        throw error;
      }

      const captureUsage = payload => {
        if (payload?.usage) reportedUsage = usageSchema.parse(payload.usage);
      };
      return {
        async snapshot() {
          const payload = await request('GET', `/sessions/${encodeURIComponent(sessionId)}/snapshot`);
          captureUsage(payload);
          return snapshotSchema.parse(payload);
        },
        async prompt(text) {
          const payload = await request('POST', `/sessions/${encodeURIComponent(sessionId)}/prompt`, { text });
          captureUsage(payload);
          return snapshotSchema.parse(payload);
        },
        async answer(requestId, answers) {
          const payload = await request('POST', `/sessions/${encodeURIComponent(sessionId)}/answer`, { requestId, answers });
          captureUsage(payload);
          return snapshotSchema.parse(payload);
        },
        async cancelQuestion(requestId) {
          const payload = await request('POST', `/sessions/${encodeURIComponent(sessionId)}/cancel-question`, { requestId });
          captureUsage(payload);
          return snapshotSchema.parse(payload);
        },
        engineMetadata() {
          return {
            engine: {
              ...reportedEngine,
              tools: bridge.calledTools(),
            },
            ...(reportedUsage ? { usage: reportedUsage } : {}),
          };
        },
        async close() {
          try {
            if (sessionId) await request('DELETE', `/sessions/${encodeURIComponent(sessionId)}`).catch(() => {});
          } finally {
            await bridge.close();
          }
        },
      };
    },
  };
}
