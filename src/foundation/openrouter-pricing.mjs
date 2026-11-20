import {OPENROUTER_MODEL} from './openrouter-policy.mjs';

// Extract only the named official endpoint. The metadata fetch itself must be
// performed by a trusted caller from OpenRouter; this function verifies shape,
// not provenance. Use the highest scheduled text rate as an estimate.
export function providerPricing(metadata,verifiedAt){
  if(!Number.isFinite(Date.parse(verifiedAt)))throw new Error('Invalid pricing observation time');
  if(metadata?.data?.id!==OPENROUTER_MODEL||!Array.isArray(metadata.data.endpoints))throw new Error('Unexpected model metadata');
  const endpoints=metadata.data.endpoints.filter(endpoint=>endpoint?.tag==='deepseek'&&endpoint.provider_name==='DeepSeek');
  if(endpoints.length!==1)throw new Error('Official DeepSeek endpoint is missing or ambiguous');
  const endpoint=endpoints[0];
  if(!['tools','tool_choice','max_tokens'].every(parameter=>endpoint.supported_parameters?.includes(parameter)))throw new Error('Provider does not report required tool parameters');
  const price=endpoint.pricing;
  if(!price||typeof price!=='object'||Array.isArray(price)||(price.overrides!==undefined&&!Array.isArray(price.overrides)))throw new Error('Invalid provider pricing');
  const rates=[price,...(price.overrides||[])];
  const getRate=key=>Math.max(...rates.map(rate=>{
    if(!rate||typeof rate[key]!=='string'||!/^\d+(?:\.\d+)?$/.test(rate[key]))throw new Error('Invalid provider text rate');
    const value=Number(rate[key]);if(!Number.isFinite(value)||value<=0)throw new Error('Invalid provider text rate');
    return value;
  }))*1_000_000;
  return {inputPerMillion:getRate('prompt'),outputPerMillion:getRate('completion'),verifiedAt};
}
