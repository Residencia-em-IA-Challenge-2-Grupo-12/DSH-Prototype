import test from 'node:test';
import assert from 'node:assert/strict';
import {providerPricing} from '../src/foundation/openrouter-pricing.mjs';

const metadata=()=>({data:{id:'deepseek/deepseek-v4.1-flash-1017',endpoints:[
  {provider_name:'Other',tag:'other',pricing:{prompt:'0.000000001',completion:'0.000000001'}},
  {provider_name:'DeepSeek',tag:'deepseek',supported_parameters:['tools','tool_choice','max_tokens'],
    pricing:{prompt:'0.00000015',completion:'0.0000006',overrides:[
      {prompt:'0.0000003',completion:'0.0000012'},
      {prompt:'0.00000015',completion:'0.0000006'}
    ]}}
]}});

test('pricing uses the highest published DeepSeek rate, including schedule overrides',()=>{
  assert.deepEqual(providerPricing(metadata(),'2026-11-11T10:00:00.000Z'),{
    inputPerMillion:0.3,outputPerMillion:1.2,verifiedAt:'2026-11-11T10:00:00.000Z'
  });
});

test('missing, ambiguous or malformed provider metadata fails closed',()=>{
  for(const change of [
    x=>x.data.id='another/model',
    x=>x.data.endpoints=x.data.endpoints.slice(0,1),
    x=>x.data.endpoints.push(structuredClone(x.data.endpoints[1])),
    x=>x.data.endpoints[1].pricing.overrides[0].completion='unknown',
    x=>x.data.endpoints[1].supported_parameters=['max_tokens']
  ]) {const x=metadata();change(x);assert.throws(()=>providerPricing(x,'2026-11-11T10:00:00.000Z'));}
  assert.throws(()=>providerPricing(metadata(),'not-a-date'));
});
