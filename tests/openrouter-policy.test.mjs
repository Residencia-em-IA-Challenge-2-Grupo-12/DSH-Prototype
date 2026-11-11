import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOpenRouterRequest} from '../src/foundation/openrouter-policy.mjs';

test('the comparison request pins the authorized model and provider without fallback',()=>{
  const request=prepareOpenRouterRequest({model:'deepseek/deepseek-v4.1-flash-1017',messages:[{role:'user',content:'Synthetic exercise'}],stream:true,
    provider:{order:['another-provider'],allow_fallbacks:true},max_tokens:256});
  assert.equal(request.model,'deepseek/deepseek-v4.1-flash-1017');
  assert.deepEqual(request.provider,{only:['DeepSeek'],allow_fallbacks:false,require_parameters:true});
  assert.equal(request.usage.include,true);
  assert.equal(request.stream_options.include_usage,true);
  assert.equal(request.max_tokens,256);
  assert.throws(()=>prepareOpenRouterRequest({model:'another-model',messages:[]}),/model/i);
  assert.throws(()=>prepareOpenRouterRequest({model:'deepseek/deepseek-v4.1-flash-1017',models:['other'],messages:[]}),/fallback/i);
});
