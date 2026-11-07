import test from 'node:test';import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import Registry from '@deepseek-ai/dsh-typert-registry';import Access from '@deepseek-ai/dsh-api-remote-access';
import Gateway from '@deepseek-ai/dsh-api-gateway';import * as ClientGateway from '@deepseek-ai/dsh-api-gateway/client';
import {installConnection} from '@deepseek-ai/dsh-client-connection/client';
import {createDomainService} from '../src/domain-service.mjs';import {CalendarHost} from '../src/foundation/dsh-calendar-host.mjs';
import {contribution,hostContribution} from '../src/foundation/dsh-calendar-descriptor.mjs';

test('hand-authored strict descriptor mounts actual client API onto real host gateway and domain service',async t=>{
 const service=createDomainService();const addr=await service.listen(0);t.after(()=>service.close());
 const origin=`http://127.0.0.1:${addr.port}`, prefix='/v1/students/ana';
 const post=async(path,data)=>{const r=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});assert.equal(r.status,201);return r.json();};
 for(const kind of ['context','evidence','calendar'])await post(prefix+'/revisions/'+kind,{expectedVersion:0,payload:{value:kind}});
 const proposal=await post(prefix+'/proposals',{versions:{context:1,evidence:1,calendar:1},payload:{near:[{id:'synthetic'}]}});
 const host=new Context();const hf=[];t.after(async()=>{for(const f of hf.reverse())await f.dispose()});
 hf.push(await host.plugin(Registry));hf.push(await host.plugin(Access));hf.push(await host.plugin(Gateway));hf.push(await host.plugin(CalendarHost,{origin,students:['ana']}));
 const hr=host.typert.register(hostContribution); t.after(()=>hr());
 const owner={principal:{kind:'owner'},signal:new AbortController().signal};
 const transport={rpc:{open(){throw Error('No streams in this test')},async call(path,endpoint,payload){assert.equal(path,'/api');const [namespace,method]=endpoint.split('/');try{return {ok:true,value:await host.typertGateway.invoke({namespace,method,args:payload.args,peer:owner})}}catch(error){return {ok:false,error:{code:error.code||'error',message:error.message}}}}}};
 const client=new Context(), cf=[];t.after(async()=>{for(const f of cf.reverse())await f.dispose()});
 cf.push(await client.plugin(Registry));cf.push(await client.plugin(ctx=>installConnection(ctx,{interactions:'none',transport})));cf.push(await client.plugin(ClientGateway));
 const unmount=await client.remote.$mount(contribution);t.after(unmount);
 const out=await client.remote.calendarSpike.read('ana',proposal.id);
 assert.equal(out.ok,true);assert.equal(out.value.proposal.id,proposal.id);assert.equal(out.value.stale,false);
 assert.equal(typeof client.remote.calendarSpike.approve,'undefined');
 const other=await client.remote.calendarSpike.read('bob',proposal.id);assert.equal(other.ok,false);
 const invalid=await client.remote.calendarSpike.read(42,proposal.id);assert.equal(invalid.ok,false);assert.equal(invalid.error.code,'gateway/input-invalid');
});
