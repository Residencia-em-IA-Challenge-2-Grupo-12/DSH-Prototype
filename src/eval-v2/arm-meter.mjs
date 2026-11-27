import { isDeepStrictEqual } from 'node:util';
import {
  actionSchema, completionUsage, EVAL_ARM_LIMITS, EVAL_LIMITS, EVAL_TOOL_METHODS, estimatedInputTokens,
} from '../runners/single-agent/eval-session.mjs';
import { normalizeContent } from '../runners/single-agent/agent-loop.mjs';

// The evaluator meters provider traffic and authorizes bridge calls against
// the actual provider response. Runner-reported telemetry is only a cross-check.
export function createArmMeter(arm) {
  const limits = EVAL_ARM_LIMITS[arm];
  const turns = [];
  const spend = [];
  let violation;
  let unchecked = false;
  let active;
  let allowed = [];
  let advertised = false;
  let finalAction;
  function reject(code) {
    violation ??= code;
    throw Object.assign(new Error('Evaluator arm budget was violated'), { code });
  }
  function expect(method, args, directed = false) {
    allowed.push({ method, args, directed });
  }
  function parse(raw) {
    try { return JSON.parse(raw); }
    catch { return null; }
  }
  return {
    beginTurn() {
      if (turns.length >= EVAL_LIMITS.maxUserTurns || active) reject('server_user_turn_limit');
      active = { completions: 0, toolAttempts: 0, inputTokens: 0, generatedTokens: 0, directedBridgeCalls: 0 };
      turns.push(active);
    },
    endTurn() {
      if (unchecked) spend.push(null);
      unchecked = false;
      active = undefined;
      allowed = [];
    },
    request(request) {
      if (violation || !active || unchecked || active.completions >= limits.completions) reject('server_completion_limit');
      allowed = [];
      finalAction = undefined;
      const remaining = EVAL_LIMITS.generatedTokens - active.generatedTokens;
      if (!Number.isSafeInteger(request.max_tokens) || request.max_tokens < 1 || request.max_tokens > remaining ||
          active.inputTokens + estimatedInputTokens(request) > EVAL_LIMITS.inputTokens) reject('server_token_limit');
      advertised = Array.isArray(request.tools) && request.tools.length > 0;
      if (advertised && (arm !== 'C3' || active.completions === limits.completions - 1 ||
          active.toolAttempts >= limits.toolAttempts)) reject('server_disabled_tools');
      active.completions++;
      unchecked = true;
    },
    response(response) {
      if (!active || !unchecked) reject('server_unexpected_completion');
      unchecked = false;
      const cost = response?.usage?.cost;
      spend.push(Number.isFinite(cost) && cost >= 0 ? cost : null);
      const message = response?.choices?.[0]?.message;
      const calls = message?.tool_calls;
      const content = normalizeContent(message?.content);
      const raw = parse(content);
      const lookup = arm === 'C1' && (raw?.action === 'needs_lookup' ||
        (!raw && /"action"\s*:\s*"needs_lookup"/.test(content)));
      const natives = calls == null ? 0 : Array.isArray(calls) ? calls.length : 1;
      active.toolAttempts += natives + (lookup ? 1 : 0);
      if (active.toolAttempts > limits.toolAttempts || (natives && !advertised)) reject('server_tool_limit');
      let usage;
      try { usage = completionUsage(response?.usage); }
      catch { reject('server_missing_token_usage'); }
      active.inputTokens += usage.input;
      active.generatedTokens += usage.generated;
      if (active.inputTokens > EVAL_LIMITS.inputTokens || active.generatedTokens > EVAL_LIMITS.generatedTokens) {
        reject('server_token_limit');
      }
      if (natives) {
        if (!Array.isArray(calls)) return;
        for (const call of calls) {
          const args = parse(call?.function?.arguments);
          const method = call?.function?.name;
          if (EVAL_TOOL_METHODS.includes(method) && args && typeof args === 'object' && !Array.isArray(args)) {
            expect(method, args, true);
          }
        }
      } else if (lookup && raw) {
        const { action: _action, ...args } = raw;
        expect('read_synthetic_file', args, true);
      } else if (!lookup) {
        const action = actionSchema.safeParse(raw);
        if (!action.success) return;
        const value = action.data;
        finalAction = value;
        if (value.citation) expect('verify_source_citation', { citation: value.citation });
        if (['propose', 'abstain_infeasible'].includes(value.action)) {
          expect('preview_plan', { ...value.options, record: value.record });
          if (value.action === 'propose') expect('propose_planning_context', { record: value.record });
        }
      }
    },
    get finalAction() { return finalAction; },
    bridge(method, args) {
      if (violation || !active || unchecked) reject('server_unexpected_bridge_call');
      const index = allowed.findIndex(entry => entry.method === method && isDeepStrictEqual(entry.args, args));
      if (index < 0) reject('server_unexpected_bridge_call');
      const [entry] = allowed.splice(index, 1);
      if (entry.directed && ++active.directedBridgeCalls > limits.toolAttempts) reject('server_tool_limit');
    },
    compare(reported) {
      const fields = ['completions', 'toolAttempts', 'inputTokens', 'generatedTokens'];
      const agrees = turns.length === reported.length && turns.every((turn, index) =>
        fields.every(field => turn[field] === reported[index][field]));
      return { turns, spend, violation, failure: violation ?? (agrees ? null : 'server_budget_disagreement') };
    },
  };
}
