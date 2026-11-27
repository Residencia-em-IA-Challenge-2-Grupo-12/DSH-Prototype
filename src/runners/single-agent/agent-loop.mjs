import { randomUUID } from 'node:crypto';
import { buildOpenAITools, buildSystemPrompt, parseAskUserQuestionArgs } from './tool-definitions.mjs';
import { EVAL_EVALUATOR_ORIGIN, syntheticHttpUrl, TOOL_BRIDGE_ROUTE } from '../../foundation/eval-transport.mjs';

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part && typeof part === 'object' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
  }
  return '';
}

async function callToolBridge(toolBridge, method, args) {
  const response = await fetch(toolBridge.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-study-run-token': toolBridge.token,
    },
    body: JSON.stringify({ method, args: args || {} }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { ok: false, error: `Non-JSON tool bridge response (${response.status})` };
  }
  if (!response.ok || parsed.ok === false) {
    return { isError: true, status: response.status, error: parsed.error || `Tool bridge error (${response.status})` };
  }
  return { isError: false, result: parsed.result };
}

/**
 * Harness-free OpenAI-compatible single-agent tool loop implementing the
 * `http-runner-v1` session semantics without depending on DSH or MCP.
 */
export function createSingleAgentSession({
  sessionId = `single-${randomUUID()}`,
  student,
  locale,
  clock,
  toolBridge,
  completeChat,
  model,
  maxSteps = 24,
  schemaCompat = 'standard',
  schemaProfile = 'v1',
  transport = 'loopback',
  onEvent,
} = {}) {
  if (typeof completeChat !== 'function') throw new Error('completeChat function is required');
  if (!toolBridge?.url || !toolBridge?.token) throw new Error('A valid toolBridge is required');
  syntheticHttpUrl(toolBridge.url, {
    transport, peer: EVAL_EVALUATOR_ORIGIN, routes: [TOOL_BRIDGE_ROUTE],
    message: 'toolBridge.url must be a loopback HTTP or explicit Compose tool endpoint',
  });

  const tools = buildOpenAITools(toolBridge.methods || [], { schemaCompat, schemaProfile });
  const conversation = [{ role: 'system', content: buildSystemPrompt({ student, clock, locale, schemaProfile }) }];
  const visibleMessages = [];
  let pendingQuestion = null; // { requestId, toolCallId, view, remainingToolCalls }
  let busy = false;
  let error = null;
  let hasTokenUsage = false;
  let inputTokens = 0;
  let outputTokens = 0;

  function recordUsage(usage) {
    if (!usage || typeof usage !== 'object') return;
    const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
    const completionTokens = usage.completion_tokens ?? usage.output_tokens;
    if (Number.isSafeInteger(promptTokens) && promptTokens >= 0 && Number.isSafeInteger(completionTokens) && completionTokens >= 0) {
      hasTokenUsage = true;
      inputTokens += promptTokens;
      outputTokens += completionTokens;
    }
  }

  function snapshot() {
    return {
      messages: [...visibleMessages],
      question: pendingQuestion ? pendingQuestion.view : null,
      busy,
      error,
      usage: hasTokenUsage
        ? { availability: 'available', inputTokens, outputTokens }
        : { availability: 'unknown' },
    };
  }

  async function executeToolCalls(toolCalls) {
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const name = call?.function?.name;
      let parsedArgs = {};
      try {
        parsedArgs = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (parseErr) {
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ isError: true, error: `Invalid JSON arguments: ${parseErr.message}` }),
        });
        continue;
      }

      if (name === 'ask_user_question') {
        try {
          const parsed = parseAskUserQuestionArgs(parsedArgs);
          const requestId = parsed.requestId || `q-${randomUUID().slice(0, 8)}`;
          pendingQuestion = {
            requestId,
            toolCallId: call.id,
            view: { requestId, questions: parsed.questions },
            remainingToolCalls: toolCalls.slice(i + 1),
          };
          return 'paused_for_question';
        } catch (validationErr) {
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ isError: true, error: validationErr.message }),
          });
          continue;
        }
      }

      const outcome = await callToolBridge(toolBridge, name, parsedArgs);
      onEvent?.({ type: 'tool', step: stepCounter, name, isError: outcome.isError, error: outcome.error });
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(outcome),
      });
    }
    return 'continue';
  }

  let stepCounter = 0;

  async function runLoop() {
    busy = true;
    error = null;
    try {
      for (let step = 0; step < maxSteps; step++) {
        stepCounter++;
        const completion = await completeChat({
          model,
          messages: conversation,
          tools,
        });
        recordUsage(completion?.usage);
        const choice = completion?.choices?.[0];
        const message = choice?.message;
        if (!message) throw new Error('Model completion returned no assistant message');

        const text = normalizeContent(message.content);
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        onEvent?.({
          type: 'llm_step',
          step: stepCounter,
          toolCalls: toolCalls.map(tc => tc?.function?.name).filter(Boolean),
          usage: completion?.usage || null,
          finishReason: choice?.finish_reason || null,
        });
        conversation.push({
          role: 'assistant',
          content: text || null,
          ...(message.reasoning_details !== undefined ? { reasoning_details: message.reasoning_details } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });
        if (text.trim()) {
          visibleMessages.push({ type: 'assistant', text: text.trim().slice(0, 12_000) });
        }

        if (!toolCalls.length) {
          return snapshot();
        }
        const state = await executeToolCalls(toolCalls);
        if (state === 'paused_for_question') {
          return snapshot();
        }
      }
      error = `Single-agent runner reached maxSteps (${maxSteps}) without completing the turn.`;
      return snapshot();
    } catch (err) {
      error = err.message;
      throw err;
    } finally {
      busy = false;
    }
  }

  return {
    sessionId,
    snapshot,
    async prompt(text) {
      if (pendingQuestion) throw new Error('Answer or cancel the pending question before sending a prompt');
      if (busy) throw new Error('Session is already processing a turn');
      if (typeof text !== 'string' || !text.trim()) throw new Error('Prompt text is required');
      const trimmed = text.trim();
      visibleMessages.push({ type: 'user', text: trimmed });
      conversation.push({ role: 'user', content: trimmed });
      return runLoop();
    },
    async answer(requestId, answers) {
      if (!pendingQuestion || pendingQuestion.requestId !== requestId) {
        throw new Error('Question is no longer pending');
      }
      if (!Array.isArray(answers) || answers.length === 0) throw new Error('Answers are required');
      const current = pendingQuestion;
      pendingQuestion = null;
      for (const item of answers) {
        const display = item.custom || (Array.isArray(item.selected) ? item.selected.join(', ') : '');
        if (display.trim()) visibleMessages.push({ type: 'user', text: display.trim() });
      }
      conversation.push({
        role: 'tool',
        tool_call_id: current.toolCallId,
        content: JSON.stringify({ answers }),
      });
      if (current.remainingToolCalls.length) {
        const state = await executeToolCalls(current.remainingToolCalls);
        if (state === 'paused_for_question') return snapshot();
      }
      return runLoop();
    },
    async cancelQuestion(requestId) {
      if (!pendingQuestion || pendingQuestion.requestId !== requestId) {
        throw new Error('Question is no longer pending');
      }
      const current = pendingQuestion;
      pendingQuestion = null;
      conversation.push({
        role: 'tool',
        tool_call_id: current.toolCallId,
        content: JSON.stringify({ cancelled: true }),
      });
      if (current.remainingToolCalls.length) {
        const state = await executeToolCalls(current.remainingToolCalls);
        if (state === 'paused_for_question') return snapshot();
      }
      return snapshot();
    },
  };
}
