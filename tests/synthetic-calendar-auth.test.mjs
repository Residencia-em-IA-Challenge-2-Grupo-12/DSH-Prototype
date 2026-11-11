import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeSyntheticCalendar} from '../src/foundation/synthetic-calendar-auth.mjs';

const redirectUri='http://127.0.0.1:4175/callback';
const run={origin:'http://127.0.0.1:4444',client:{id:'synthetic-client',secret:'synthetic-secret',redirectUris:[redirectUri]}};

test('trusted synthetic authorization validates consent, redirect and state',async()=>{
  const calls=[];let state;
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(calls.length===1){state=new URL(url).searchParams.get('state');return new Response('<input name="consent" value="synthetic-nonce">',{status:200});}
    if(calls.length===2)return new Response(null,{status:302,headers:{location:`${redirectUri}?code=synthetic-code&state=${state}`}});
    return new Response(JSON.stringify({access_token:'synthetic-token'}),{status:200,headers:{'content-type':'application/json'}});
  };
  const token=await authorizeSyntheticCalendar({run,student:'ana',redirectUri,fetchImpl});
  assert.equal(token,'synthetic-token');assert.equal(calls.length,3);
  assert(calls.every(call=>new URL(call.url).origin===run.origin));
  assert.equal(calls[1].options.redirect,'manual');
});

test('authorization refuses remote origins and mismatched redirect state without exchanging a code',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;if(calls===1)return new Response('<input name="consent" value="nonce">',{status:200});return new Response(null,{status:302,headers:{location:`${redirectUri}?code=code&state=wrong`}});};
  await assert.rejects(authorizeSyntheticCalendar({run:{...run,origin:'https://example.com'},student:'ana',redirectUri,fetchImpl}));
  assert.equal(calls,0);
  await assert.rejects(authorizeSyntheticCalendar({run,student:'ana',redirectUri,fetchImpl}),/state/i);
  assert.equal(calls,2);
  await assert.rejects(authorizeSyntheticCalendar({run,student:'real-user',redirectUri,fetchImpl}));
});
