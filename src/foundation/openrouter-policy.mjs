export const OPENROUTER_MODEL='deepseek/deepseek-v4.1-flash-1017';
export const DEFAULT_OPENROUTER_PROVIDER_ONLY=['deepseek'];
export const MAX_OUTPUT_TOKENS=8192;

export function normalizeOpenRouterPolicy(policy){
  if(policy===undefined||policy===null){
    return {allowedModels:new Set([OPENROUTER_MODEL]),providerOnly:DEFAULT_OPENROUTER_PROVIDER_ONLY,requireParameters:true};
  }
  if(typeof policy!=='object'||Array.isArray(policy))throw new Error('Invalid OpenRouter policy');
  const rawModels=policy.allowedModels??[OPENROUTER_MODEL];
  if(!Array.isArray(rawModels)||!rawModels.length||rawModels.some(model=>typeof model!=='string'||!model.trim())){
    throw new Error('OpenRouter policy requires at least one allowed model');
  }
  const providerOnly=policy.providerOnly===undefined
    ? (rawModels.length===1&&rawModels[0]===OPENROUTER_MODEL?DEFAULT_OPENROUTER_PROVIDER_ONLY:null)
    : policy.providerOnly;
  if(providerOnly!==null&&(!Array.isArray(providerOnly)||!providerOnly.length||providerOnly.some(provider=>typeof provider!=='string'||!provider.trim()))){
    throw new Error('OpenRouter policy providerOnly must be a non-empty string array or null');
  }
  const requireParameters=policy.requireParameters===undefined?true:policy.requireParameters;
  if(typeof requireParameters!=='boolean')throw new Error('OpenRouter policy requireParameters must be a boolean');
  return {allowedModels:new Set(rawModels),providerOnly,requireParameters};
}

// Shape only; this function does not make a request or handle credentials.
export function prepareOpenRouterRequest(input,policy){
  const resolved=normalizeOpenRouterPolicy(policy);
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.model!=='string'||!resolved.allowedModels.has(input.model)){
    throw new Error('Unauthorized comparison model');
  }
  if(input.models!==undefined||input.route!==undefined)throw new Error('Model fallback or routing is not allowed');
  if(input.plugins!==undefined&&(!Array.isArray(input.plugins)||input.plugins.length))throw new Error('Provider plugins are not allowed');
  if(!Array.isArray(input.messages)||!input.messages.length)throw new Error('At least one message is required');
  const requested=input.max_tokens??input.max_completion_tokens??MAX_OUTPUT_TOKENS;
  if(!Number.isSafeInteger(requested)||requested<1)throw new Error('Invalid output token limit');
  const provider={
    ...(resolved.providerOnly?{only:[...resolved.providerOnly]}:{}),
    allow_fallbacks:false,
    require_parameters:resolved.requireParameters,
  };
  const body={...input,max_tokens:Math.min(requested,MAX_OUTPUT_TOKENS),provider,usage:{include:true}};
  delete body.max_completion_tokens;
  if(input.stream)body.stream_options={...(input.stream_options||{}),include_usage:true};
  return body;
}
