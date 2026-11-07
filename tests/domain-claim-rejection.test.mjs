import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDomainService } from '../src/domain-service.mjs';

// Exercise the actual HTTP request handler without opening a socket.
test('claim rejection marker is emitted only for definitive rollback',async()=>{
  const service=createDomainService();
  service.server.address=()=>({port:4176});
  function request(path,method='GET',body){return new Promise((resolve,reject)=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    Object.assign(req,{method,url:path,headers:{host:'127.0.0.1:4176',...(body===undefined?{}:{'content-type':'application/json'})},socket:{remoteAddress:'127.0.0.1'}});
    const res={headersSent:false,writeHead(status){this.status=status;this.headersSent=true;},end(data){try{resolve({status:this.status,body:JSON.parse(data)});}catch(error){reject(error);}},destroy(){reject(Error('Unexpected response destruction'));}};
    service.server.emit('request',req,res);
  });}
  try {
    const root='/v1/students/ana';
    for(const kind of ['context','evidence','calendar'])assert.equal((await request(`${root}/revisions/${kind}`,'POST',{expectedVersion:0,payload:{kind}})).status,201);
    const action={type:'create',calendarId:'calendar',event:{id:'abcde'}};
    const created=await request(`${root}/proposals`,'POST',{versions:{context:1,evidence:1,calendar:1},payload:{sections:{near:{action}}}});
    const id=created.body.id;
    const unapproved=await request(`${root}/proposals/${id}/applications`,'POST',{section:'near',action});
    assert.equal(unapproved.status,409);assert.equal(unapproved.body.claimCommitted,false);
    await request(`${root}/proposals/${id}/decisions`,'POST',{section:'near',choice:'approve'});
    const claimed=await request(`${root}/proposals/${id}/applications`,'POST',{section:'near',action});
    assert.equal(claimed.status,201);assert.equal(claimed.body.state,'pending');
    const blocked=await request(`${root}/proposals/${id}/applications`,'POST',{section:'near',action});
    assert.equal(blocked.status,409);assert.equal(blocked.body.claimCommitted,undefined);
  } finally {await service.close();}
});
