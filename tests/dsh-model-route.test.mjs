import test from 'node:test';
import assert from 'node:assert/strict';
import {createGatewayRoute} from '../src/foundation/dsh-model-route.mjs';

test('only a local trusted gateway and a dedicated internal credential can configure the comparison route',()=>{
  const route=createGatewayRoute({baseURL:'http://127.0.0.1:12345/v1',accessToken:'a'.repeat(64)});
  assert.equal(route.provider,'study-gateway');
  assert.equal(route.model,'deepseek/deepseek-v4.1-flash-1017');
  assert.equal(route.env.STUDY_GATEWAY_BASE_URL,'http://127.0.0.1:12345/v1');
  assert.equal(route.env.STUDY_GATEWAY_TOKEN,'a'.repeat(64));
  assert(route.patch.endsWith('/dsh-gateway.patch.yml'));
  for(const baseURL of ['https://openrouter.ai/api/v1','http://example.test/v1','http://model-gateway:8090/other','http://user:pass@model-gateway:8090/v1','http://model-gateway:8090/v1?extra=1'])
    assert.throws(()=>createGatewayRoute({baseURL,accessToken:'a'.repeat(64)}));
  assert.throws(()=>createGatewayRoute({baseURL:'http://127.0.0.1:12345/v1',accessToken:'short'}));
});
