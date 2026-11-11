export const OPENROUTER_MODEL='deepseek/deepseek-v4.1-flash-1017';
export const MAX_OUTPUT_TOKENS=8192;

// Shape only; this function does not make a request or handle credentials.
export function prepareOpenRouterRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.model!==OPENROUTER_MODEL)throw new Error('Unauthorized comparison model');
  if(input.models!==undefined||input.route!==undefined)throw new Error('Model fallback or routing is not allowed');
  if(input.plugins!==undefined&&(!Array.isArray(input.plugins)||input.plugins.length))throw new Error('Provider plugins are not allowed');
  if(!Array.isArray(input.messages)||!input.messages.length)throw new Error('At least one message is required');
  const requested=input.max_tokens??input.max_completion_tokens??MAX_OUTPUT_TOKENS;
  if(!Number.isSafeInteger(requested)||requested<1)throw new Error('Invalid output token limit');
  const body={...input,max_tokens:Math.min(requested,MAX_OUTPUT_TOKENS),
    provider:{only:['deepseek'],allow_fallbacks:false,require_parameters:true},usage:{include:true}};
  delete body.max_completion_tokens;
  if(input.stream)body.stream_options={...(input.stream_options||{}),include_usage:true};
  return body;
}
