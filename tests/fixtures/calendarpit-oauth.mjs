import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

// Synthetic consent only. The returned bearer token remains in the trusted
// test controller and is never mounted in the agent container or logged.
export async function syntheticToken(run,userId,redirectUri){
  const state=randomBytes(16).toString('hex'),authUrl=new URL('/oauth/authorize',run.origin);
  authUrl.search=new URLSearchParams({client_id:run.client.id,redirect_uri:redirectUri,response_type:'code',
    scope:'https://www.googleapis.com/auth/calendar',state});
  const page=await fetch(authUrl,{signal:AbortSignal.timeout(5000)});assert.equal(page.status,200);
  const nonce=(await page.text()).match(/name="consent" value="([^"]+)"/)?.[1];assert(nonce);
  const decision=await fetch(`${run.origin}/oauth/authorize`,{method:'POST',redirect:'manual',headers:{origin:run.origin,'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({consent:nonce,user_id:userId,decision:'approve'}),signal:AbortSignal.timeout(5000)});
  assert.equal(decision.status,302);const callback=new URL(decision.headers.get('location'));
  assert.equal(callback.origin+callback.pathname,redirectUri);assert.equal(callback.searchParams.get('state'),state);
  const code=callback.searchParams.get('code');assert(code);
  const response=await fetch(`${run.origin}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:run.client.id,client_secret:run.client.secret}),signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,200);const {access_token:token}=await response.json();assert(token);return token;
}
