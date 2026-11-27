const tokens = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function evalTokenUsage(usage, { decision = false, normalized = false } = {}) {
  const input = tokens(usage?.input_tokens ?? usage?.prompt_tokens);
  const output = tokens(usage?.output_tokens ?? usage?.completion_tokens);
  if (decision) return { input, generated: output ?? 0 };
  if (output === null || normalized) return { input, generated: output };
  const total = tokens(usage.total_tokens);
  const details = tokens(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens);
  const combined = total !== null && input !== null && total - input >= output ? total - input : null;
  const separate = details === null && combined === null ? tokens(usage.reasoning_tokens) : null;
  return { input, generated: Math.max(output + (separate ?? 0), combined ?? 0, details ?? 0) };
}
