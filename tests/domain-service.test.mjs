import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDomainService } from '../src/domain-service.mjs';

async function fixture() {
  const service=createDomainService();const address=await service.listen();
  const base=`http://127.0.0.1:${address.port}`;
  async function request(path,{method='GET',body,headers={}}={}) {
    const response=await fetch(base+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  function rawHost(host){return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:address.port,path:'/health',headers:{host}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end();
  });}
  return {service,request,rawHost};
}
test('HTTP service persists scoped, versioned proposals and independently approved decisions',async()=>{
  const {service,request}=await fixture();
  try {
    const student='/v1/students/ana';
    for(const kind of ['context','evidence','calendar']){
      const created=await request(`${student}/revisions/${kind}`,{method:'POST',body:{expectedVersion:0,payload:{kind}}});
      assert.equal(created.status,201);
    }
    const versions=(await request(`${student}/versions`)).body;
    assert.deepEqual(versions,{context:1,evidence:1,calendar:1});
    const proposal=(await request(`${student}/proposals`,{method:'POST',body:{versions,payload:{blocks:[]}}})).body;
    assert.equal((await request(`/v1/students/bruno/proposals/${proposal.id}`)).status,404);
    assert.equal((await request(`${student}/proposals/${proposal.id}/approval/near`)).status,409);
    assert.equal((await request(`${student}/proposals/${proposal.id}/decisions`,{method:'POST',body:{section:'near',choice:'approve'}})).status,201);
    assert.equal((await request(`${student}/proposals/${proposal.id}/approval/near`)).status,200);
    assert.equal((await request(`${student}/proposals/${proposal.id}/decisions`,{method:'POST',body:{section:'future',choice:'reject'}})).status,201);
    assert.equal((await request(`${student}/proposals/${proposal.id}/approval/future`)).status,409);
    assert.equal((await request(`${student}/revisions/calendar`,{method:'POST',body:{expectedVersion:1,payload:{changed:true}}})).status,201);
    assert.equal((await request(`${student}/proposals/${proposal.id}/approval/near`)).status,409);
    assert.equal((await request(`${student}/proposals`,{method:'POST',body:{versions,payload:{blocks:[]}}})).status,409);
    assert.equal((await request(`${student}/revisions/calendar/1`)).body.payload.kind,'calendar');
  } finally {await service.close();}
});
test('HTTP validation rejects malformed requests, browser origins and conflicting concurrent writes',async()=>{
  const {service,request,rawHost}=await fixture();
  try {
    assert.equal((await request('/health')).body.calendarWrites,false);
    assert.equal(await rawHost('attacker.example'),403);
    assert.equal((await request('/health',{headers:{origin:'https://attacker.example'}})).status,403);
    assert.equal((await request('/health?extra=true')).status,400);
    assert.equal((await request('/v1/students/ana/revisions/context',{method:'POST',body:[],headers:{'content-type':'text/plain'}})).status,415);
    assert.equal((await request('/v1/students/ana/revisions/context',{method:'POST',body:{expectedVersion:0,payload:{},extra:true}})).status,400);
    assert.equal((await request('/v1/students/ana/revisions/context',{method:'POST',body:{expectedVersion:0,payload:{large:'a'.repeat(66000)}}})).status,413);
    const writes=await Promise.all([1,2].map(i=>request('/v1/students/ana/revisions/context',{method:'POST',body:{expectedVersion:0,payload:{i}}})));
    assert.deepEqual(writes.map(r=>r.status).sort(),[201,409]);
    assert.equal((await request('/v1/students/ana/versions')).body.context,1);
    assert.equal((await request('/v1/students/ana/revisions/calendar/not-a-number')).status,400);
  } finally {await service.close();}
});
