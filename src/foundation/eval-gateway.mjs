import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { MAX_OUTPUT_TOKENS, prepareOpenRouterRequest } from './openrouter-policy.mjs';
import { EVAL_EVALUATOR_ORIGIN, syntheticHttpUrl, TOOL_BRIDGE_ROUTE } from './eval-transport.mjs';
import { evalTokenUsage } from './eval-usage.mjs';

const routes = {
  openrouter: {
    path: '/v1/chat/completions',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: 'OPENROUTER_API_KEY',
  },
  gemini: {
    path: '/v1/gemini/chat/completions',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    key: 'GEMINI_API_KEY',
  },
  'gemini-paid': {
    path: '/v1/gemini-paid/chat/completions',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    key: 'GEMINI_PAID_API_KEY',
  },
  typesafe: {
    path: '/v1/systemone',
    url: 'https://api.typesafe.ai/v1/systemone',
    key: 'TYPESAFE_API_KEY',
    decision: true,
  },
  openrouterDecision: {
    path: '/v1/systemone',
    url: 'https://openrouter.ai/api/v1/systemone',
    key: 'OPENROUTER_API_KEY',
    decision: true,
  },
};
const knownPaths = new Set(Object.values(routes).map(route => route.path));
const operatorModel = 'mistralai/mistral-small-2603';
const judgeModels = new Map([
  ['jev-1.14.0', routes.typesafe],
  ['liquid/d1.2-ultra', routes.openrouterDecision],
  ['mistralai/mistral-large-4-0', routes.openrouter],
]);
const chatFields = ['model', 'messages', 'tools', 'tool_choice', 'parallel_tool_calls', 'response_format',
  'temperature', 'top_p', 'seed', 'max_tokens', 'max_completion_tokens', 'reasoning_effort'];
const decisionFields = ['model', 'state', 'context', 'messages', 'questions'];
const criterionText = value => typeof value === 'string' && Boolean(value.trim());
function validQuestion(question) {
  const criteria = question?.criteria;
  if (question?.type === 'score') {
    return Array.isArray(criteria) && criteria.length >= 2 && criteria.length <= 10 && criteria.every(criterionText);
  }
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) return false;
  if (question.type === 'noul') return Object.keys(criteria).length === 2 && criterionText(criteria.true) && criterionText(criteria.false);
  return question.type === 'choice' && Object.keys(criteria).length >= 2 &&
    Object.entries(criteria).every(([name, text]) => criterionText(name) && criterionText(text));
}
const digest = value => createHash('sha256').update(value).digest();
const dollars = value => Number.isFinite(value) && value >= 0;

function send(res, status, body) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(stream, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('JSON body is too large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value;
}

function prepareRequest(input, route, policy) {
  if (route.decision) {
    const questionList = Array.isArray(input.questions)
      ? input.questions
      : (input.questions && typeof input.questions === 'object' ? Object.values(input.questions) : null);
    if (!questionList || !questionList.length ||
        questionList.some(question => !validQuestion(question))) {
      throw new Error('System One requires noul, choice, or score questions with valid criteria');
    }
    return Object.fromEntries(decisionFields.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
  }
  if (input.models !== undefined || input.route !== undefined || input.plugins !== undefined) {
    throw new Error('Client model routing and plugins are unavailable');
  }
  if (input.stream !== undefined && input.stream !== false) throw new Error('Eval chat requires non-streaming completions');
  if (!Array.isArray(input.messages) || !input.messages.length) throw new Error('At least one chat message is required');
  if (input.tools !== undefined && (!Array.isArray(input.tools) || input.tools.some(tool => tool?.type !== 'function'))) {
    throw new Error('Only function tools are available');
  }
  const body = Object.fromEntries(chatFields.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
  if (body.seed !== undefined && !Number.isSafeInteger(body.seed)) throw new Error('Invalid seed');
  const requested = input.max_tokens ?? input.max_completion_tokens ?? MAX_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('Invalid output token limit');
  if (policy.supportsTemperature !== true) delete body.temperature;
  body.max_tokens = Math.min(requested, MAX_OUTPUT_TOKENS);
  delete body.max_completion_tokens;
  body.stream = false;
  if ((route === routes.gemini || route === routes['gemini-paid']) && body.reasoning_effort !== undefined && body.reasoning_effort !== 'low') {
    throw new Error('Gemini reasoning_effort must be low when supplied');
  }
  return route === routes.openrouter
    ? prepareOpenRouterRequest(body, {
        allowedModels: [body.model],
        providerOnly: policy.providerOnly,
        requireParameters: policy.requireParameters,
      })
    : body;
}

function priceFor(pricing, inputTokens, outputTokens) {
  return (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / 1_000_000;
}

function estimateCost(body, pricing, decision) {
  if (!pricing || !dollars(pricing.inputPerMillion) || !dollars(pricing.outputPerMillion)) {
    throw new Error('A verified price for this model is required');
  }
  const age = Date.now() - Date.parse(pricing.verifiedAt);
  if (!Number.isFinite(age) || age < 0 || age > 86_400_000) throw new Error('Current model pricing is required');
  if (pricing.freeTier === true) {
    if (pricing.inputPerMillion !== 0 || pricing.outputPerMillion !== 0) {
      throw new Error('freeTier pricing requires zero input and output rates');
    }
    return 0;
  }
  if (pricing.inputPerMillion === 0 && (decision || pricing.outputPerMillion === 0)) {
    throw new Error('A verified price for this model is required');
  }
  const inputEstimate = Buffer.byteLength(JSON.stringify(body), 'utf8') * 2 + 4096;
  return priceFor(pricing, inputEstimate, decision ? 0 : body.max_tokens);
}

function usageFor(payload, route, pricing) {
  const usage = payload.usage ?? (route.decision ? payload : {});
  const { input: inputTokens, generated: billedOutput } = evalTokenUsage(usage, { decision: route.decision });
  const cost = usage?.cost ?? usage?.cost_usd;
  if (dollars(cost) && (cost > 0 || pricing?.freeTier !== true)) {
    return { inputTokens, outputTokens: billedOutput, actualUsd: cost, source: 'provider' };
  }
  if (pricing?.freeTier === true) {
    if (inputTokens !== null && billedOutput !== null) {
      return { inputTokens, outputTokens: billedOutput, actualUsd: 0, source: 'free-tier' };
    }
    return { inputTokens, outputTokens: billedOutput, actualUsd: null, source: 'unknown' };
  }
  if ((route === routes.gemini || route === routes['gemini-paid'] || route.decision) && inputTokens !== null && billedOutput !== null) {
    return { inputTokens, outputTokens: billedOutput, actualUsd: priceFor(pricing, inputTokens, billedOutput), source: 'token-rates' };
  }
  return { inputTokens, outputTokens: billedOutput, actualUsd: null, source: 'unknown' };
}

const RETRYABLE_UPSTREAM_STATUSES = new Set([429, 500, 502, 503, 504]);
const RELEASE_ON_ERROR_STATUSES = new Set([500, 502, 503, 504]);

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryDelayFor(response, attempt, baseDelayMs) {
  const retryAfter = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 10) {
    return Math.min(10_000, Math.round(retryAfter * 1000));
  }
  return Math.min(10_000, baseDelayMs * (2 ** attempt));
}

// Construct one gateway per run. Only runnerToken crosses into the runner.
// Pricing and model policies come from the trusted evaluator configuration.
export function createEvalGateway({
  roleAModel, roleAProvider = 'openrouter', modelPolicies = {}, apiKeys = process.env, budget, fetchImpl = fetch,
  maxTransientRetries = 3, retryBaseDelayMs = 1500,
} = {}) {
  if (typeof roleAModel !== 'string' || !roleAModel.trim() || judgeModels.has(roleAModel) || roleAModel === operatorModel ||
      !['openrouter', 'gemini', 'gemini-paid'].includes(roleAProvider)) throw new Error('A separate Role A chat model and provider are required');
  if (typeof budget?.reserve !== 'function' || typeof budget?.settle !== 'function') throw new Error('A local eval budget is required');

  const bindings = {
    agent: new Map([[roleAModel, routes[roleAProvider]]]),
    operator: new Map([[operatorModel, routes.openrouter]]),
    judge: judgeModels,
  };
  const routeByModel = new Map([
    [roleAModel, routes[roleAProvider]],
    [operatorModel, routes.openrouter],
    ...judgeModels.entries(),
  ]);
  const policies = new Map();
  for (const [model, modelRoute] of routeByModel.entries()) {
    const policy = Object.hasOwn(modelPolicies, model) ? structuredClone(modelPolicies[model]) : {};
    if (policy.providerOnly != null) {
      if (modelRoute !== routes.openrouter) throw new Error('providerOnly pin is only supported for OpenRouter chat models');
      if (!Array.isArray(policy.providerOnly) || !policy.providerOnly.length ||
          policy.providerOnly.some(provider => typeof provider !== 'string' || !provider.trim())) throw new Error('Invalid per-model provider pin');
    }
    if (policy.requireParameters !== undefined) {
      if (modelRoute !== routes.openrouter) throw new Error('requireParameters is only supported for OpenRouter chat models');
      if (typeof policy.requireParameters !== 'boolean') throw new Error('Invalid requireParameters policy');
    }
    if (policy.pricing?.freeTier === true && modelRoute === routes['gemini-paid']) {
      throw new Error('gemini-paid route cannot use freeTier pricing');
    }
    if (policy.pricing?.freeTier === true && (policy.pricing.inputPerMillion !== 0 || policy.pricing.outputPerMillion !== 0)) {
      throw new Error('freeTier pricing requires zero input and output rates');
    }
    policies.set(model, {
      ...policy,
      providerOnly: policy.providerOnly ?? null,
      requireParameters: policy.requireParameters ?? true,
    });
  }
  const upstreamKeys = new Map(Object.values(routes).map(route => [route, apiKeys[route.key]]));
  const runnerToken = randomBytes(32).toString('base64url');
  const operatorToken = randomBytes(32).toString('base64url');
  const judgeToken = randomBytes(32).toString('base64url');
  const credentials = Object.entries({ agent: runnerToken, operator: operatorToken, judge: judgeToken })
    .map(([role, token]) => [role, digest(`Bearer ${token}`)]);
  let active = true;
  const retireController = new AbortController();
  let bridge;
  let inspectRunnerRequest;
  let inspectRunnerResponse;

  const server = createServer(async (req, res) => {
    if (active && req.url === TOOL_BRIDGE_ROUTE && bridge) return bridge(req, res);
    if (req.method !== 'POST' || !knownPaths.has(req.url)) return send(res, 404, { error: 'Unknown eval gateway route' });
    const bearer = digest(req.headers.authorization || '');
    const role = active && credentials.find(([, expected]) => timingSafeEqual(bearer, expected))?.[0];
    if (!role) return send(res, 401, { error: 'Active eval gateway authorization required' });

    let input;
    try { input = await readJson(req, 1_000_000); }
    catch { return send(res, 400, { error: 'Invalid gateway request body' }); }
    const route = bindings[role].get(input.model);
    if (!route || route.path !== req.url) return send(res, 403, { error: 'Model or route unavailable for this role' });

    const policy = policies.get(input.model);
    const key = upstreamKeys.get(route);
    if (typeof key !== 'string' || !key.trim()) return send(res, 503, { error: 'Configured provider credentials unavailable' });
    let body, estimate;
    try {
      if (role === 'judge' && route === routes.openrouter &&
          (policy.providerOnly?.length !== 1 || input.reasoning_effort !== 'low' || input.max_tokens !== 4096)) {
        throw new Error('Role B2 chat requires the pinned provider, low reasoning, and 4096 output tokens');
      }
      if (role === 'agent') inspectRunnerRequest?.(input);
      body = prepareRequest(input, route, policy);
      estimate = estimateCost(body, policy.pricing, route.decision);
    } catch (error) { return send(res, 400, { error: error.message }); }

    if (!active) return send(res, 401, { error: 'Eval run has retired' });
    const requestController = new AbortController();
    const onClose = () => { if (!res.writableEnded) requestController.abort(new Error('Client disconnected')); };
    res.once('close', onClose);
    if (res.destroyed || res.closed) requestController.abort(new Error('Client disconnected'));
    if (requestController.signal.aborted) {
      res.off('close', onClose);
      return;
    }
    let reservation;
    try { reservation = await budget.reserve({ role, estimatedUsd: estimate, allowZero: policy.pricing?.freeTier === true }); }
    catch (error) {
      res.off('close', onClose);
      if (res.headersSent || res.destroyed) return;
      return send(res, 409, { error: error.message });
    }
    const signal = AbortSignal.any([AbortSignal.timeout(120_000), retireController.signal, requestController.signal]);
    let inBackoff = false;
    try {
      let upstream;
      for (let attempt = 0; ; attempt++) {
        if (!active) {
          await budget.settle(reservation.id, { actualUsd: 0, ...(route.decision ? { outputTokens: 0 } : {}) });
          return send(res, 401, { error: 'Eval run has retired' });
        }
        if (requestController.signal.aborted || res.destroyed) {
          await budget.settle(reservation.id, { actualUsd: 0, ...(route.decision ? { outputTokens: 0 } : {}) });
          if (!res.destroyed) res.destroy();
          return;
        }
        upstream = await fetchImpl(route.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          redirect: 'error',
          signal,
        });
        if (!upstream.ok && RETRYABLE_UPSTREAM_STATUSES.has(upstream.status) && attempt < maxTransientRetries) {
          await upstream.body?.cancel().catch(() => {});
          if (!active) {
            await budget.settle(reservation.id, { actualUsd: 0 });
            return send(res, 401, { error: 'Eval run has retired' });
          }
          inBackoff = true;
          await sleep(retryDelayFor(upstream, attempt, retryBaseDelayMs), signal);
          inBackoff = false;
          continue;
        }
        break;
      }
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel().catch(() => {});
        if (!upstream.ok && ((upstream.status >= 400 && upstream.status < 500) || RELEASE_ON_ERROR_STATUSES.has(upstream.status))) {
          await budget.settle(reservation.id, { actualUsd: 0, ...(route.decision ? { outputTokens: 0 } : {}) });
          return send(res, 502, { error: 'Provider request failed', upstreamStatus: upstream.status });
        }
        throw new Error('Provider request failed');
      }
      const payload = await readJson(upstream.body, 5_000_000);
      const { inputTokens, outputTokens, actualUsd, source } = usageFor(payload, route, policy.pricing);
      await budget.settle(reservation.id, { inputTokens, outputTokens, actualUsd });
      const result = { ...payload,
        usage: { ...payload.usage, input_tokens: inputTokens, output_tokens: outputTokens, cost: actualUsd, cost_source: source } };
      if (role === 'agent' && inspectRunnerResponse) {
        try { inspectRunnerResponse(result); }
        catch { return send(res, 422, { error: 'Runner response failed evaluator checks' }); }
      }
      return send(res, 200, result);
    } catch {
      const settledUsd = inBackoff ? 0 : null;
      try { await budget.settle(reservation.id, { actualUsd: settledUsd, ...(route.decision ? { outputTokens: 0 } : {}) }); }
      catch { /* Preserve an unresolved reservation on ledger failure. */ }
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      return send(res, !active ? 401 : 502, { error: !active ? 'Eval run has retired' : 'Provider request or usage accounting failed' });
    } finally {
      res.off('close', onClose);
    }
  });

  return {
    server, runnerToken, operatorToken, judgeToken,
    inspectRunnerRequests(inspect) {
      if (!active || inspectRunnerRequest || typeof inspect !== 'function') throw new Error('Cannot inspect eval runner requests');
      inspectRunnerRequest = inspect;
      return () => { if (inspectRunnerRequest === inspect) inspectRunnerRequest = undefined; };
    },
    inspectRunnerResponses(inspect) {
      if (!active || inspectRunnerResponse || typeof inspect !== 'function') throw new Error('Cannot inspect eval runner responses');
      inspectRunnerResponse = inspect;
      return () => { if (inspectRunnerResponse === inspect) inspectRunnerResponse = undefined; };
    },
    mountToolBridge(handler) {
      if (!active || bridge || typeof handler !== 'function') throw new Error('Cannot mount eval tool bridge');
      bridge = handler;
      return () => { if (bridge === handler) bridge = undefined; };
    },
    retire() {
      active = false;
      retireController.abort(new Error('Eval run has retired'));
      bridge = undefined;
      inspectRunnerRequest = undefined;
      inspectRunnerResponse = undefined;
    },
  };
}

// Used by evaluator-owned roles. Redirects cannot forward role credentials.
export async function requestEvalGateway({ origin, token, path, body, transport = 'loopback', fetchImpl = fetch }) {
  if (!knownPaths.has(path) || typeof token !== 'string' || !token) throw new Error('Invalid evaluator gateway request');
  const base = syntheticHttpUrl(origin, {
    transport, peer: EVAL_EVALUATOR_ORIGIN, routes: ['/'], message: 'Invalid evaluator gateway origin',
  });
  const response = await fetchImpl(base.origin + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Evaluator gateway returned HTTP ${response.status}`);
  }
  return readJson(response.body, 5_000_000);
}
