const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
export const EVAL_RUNNER_ORIGIN = 'http://runner:4180';
export const EVAL_EVALUATOR_ORIGIN = 'http://evaluator:4181';
export const EVAL_CALENDAR_ORIGIN = 'http://calendarpit:4173';
export const TOOL_BRIDGE_ROUTE = '/tools/call';

export function assertTransport(transport) {
  if (transport !== 'loopback' && transport !== 'compose-eval') throw new Error('Unknown synthetic transport');
}

export function syntheticHttpUrl(raw, {
  transport = 'loopback', peer, routes, requirePort = false, message = 'Synthetic loopback URL required',
} = {}) {
  assertTransport(transport);
  if (typeof raw !== 'string' || raw.includes('@')) throw new Error(message);
  let url;
  try { url = new URL(raw); } catch { throw new Error(message); }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash ||
      (requirePort && !url.port) || (routes && !routes.includes(url.pathname))) throw new Error(message);
  if (loopback.has(url.hostname)) return url;
  if (transport === 'compose-eval' && url.origin === peer &&
      (raw === peer || raw === peer + url.pathname)) return url;
  throw new Error(message);
}
