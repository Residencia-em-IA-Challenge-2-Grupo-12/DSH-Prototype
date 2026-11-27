import {randomBytes} from 'node:crypto';
import {assertStudent} from '../domain/runtime.mjs';
import {EVAL_CALENDAR_ORIGIN,syntheticHttpUrl} from './eval-transport.mjs';

// Trusted orchestrator only: performs consent for the simulator's fictional
// users. The redirect is inspected locally and never followed.
export async function authorizeSyntheticCalendar({run,student,redirectUri,fetchImpl=fetch,allowedStudents,transport='loopback'}={}){
  try{assertStudent(student,allowedStudents);}catch{throw new Error('Unknown synthetic student');}
  const endpoint={requirePort:true,message:'Synthetic loopback or explicit Compose endpoints are required'};
  const origin=syntheticHttpUrl(run?.origin,{...endpoint,transport,peer:EVAL_CALENDAR_ORIGIN,routes:['/']});
  const redirect=syntheticHttpUrl(redirectUri,{...endpoint,routes:['/callback']});
  if(transport==='compose-eval'&&redirect.hostname!=='127.0.0.1')throw new Error('Synthetic Compose redirect must be on 127.0.0.1');
  if(!run?.client||typeof run.client.id!=='string'||!run.client.id||typeof run.client.secret!=='string'||!run.client.secret||
    !Array.isArray(run.client.redirectUris)||!run.client.redirectUris.includes(redirect.href))throw new Error('Synthetic client configuration is invalid');
  if(typeof fetchImpl!=='function')throw new Error('A fetch implementation is required');
  const state=randomBytes(16).toString('hex'),url=new URL('/oauth/authorize',origin);
  url.search=new URLSearchParams({client_id:run.client.id,redirect_uri:redirect.href,response_type:'code',scope:'https://www.googleapis.com/auth/calendar',state});
  const page=await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(page.status!==200)throw new Error('Synthetic authorization page unavailable');
  const html=await page.text();if(html.length>1_000_000)throw new Error('Synthetic authorization page too large');
  const nonce=html.match(/name="consent" value="([^"]{1,512})"/)?.[1];if(!nonce)throw new Error('Synthetic consent nonce missing');
  const decision=await fetchImpl(new URL('/oauth/authorize',origin).href,{method:'POST',redirect:'manual',
    headers:{origin:origin.origin,'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({consent:nonce,user_id:student,decision:'approve'}),signal:AbortSignal.timeout(5000)});
  if(decision.status!==302)throw new Error('Synthetic consent was not accepted');
  let callback;try{callback=new URL(decision.headers.get('location'));}catch{throw new Error('Synthetic callback is invalid');}
  if(callback.origin+callback.pathname!==redirect.origin+redirect.pathname||callback.username||callback.password||callback.hash)throw new Error('Synthetic callback does not match the registered redirect');
  if(callback.searchParams.get('state')!==state)throw new Error('Synthetic authorization state mismatch');
  const code=callback.searchParams.get('code');if(!code||code.length>4096)throw new Error('Synthetic authorization code missing');
  const response=await fetchImpl(new URL('/oauth/token',origin).href,{method:'POST',redirect:'error',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirect.href,client_id:run.client.id,client_secret:run.client.secret}),signal:AbortSignal.timeout(5000)});
  if(response.status!==200)throw new Error('Synthetic token exchange failed');
  const {access_token:token}=await response.json();
  if(typeof token!=='string'||!token||token.length>4096)throw new Error('Synthetic bearer token missing');
  return token;
}
