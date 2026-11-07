// CALENDARPIT_LIVE_TEST=1 node --test --test-isolation=none tests/calendar-experiment.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CalendarApiError } from '../src/foundation/calendarpit-api.mjs';
import { startCalendarExperiment, replayCalendarExperiment } from '../src/foundation/calendar-experiment.mjs';
import { createDomainService } from '../src/domain-service.mjs';
import { DomainObservationClient } from '../src/foundation/domain-http-observer-client.mjs';
import { observeCalendar } from '../src/foundation/calendar-domain-observer.mjs';
import { applyApprovedCreate } from '../src/foundation/calendar-approved-create.mjs';

async function syntheticToken(run, userId, redirectUri) {
  const credentials = run.syntheticCredentials();
  const state = randomBytes(16).toString('hex');
  const authUrl = new URL('/oauth/authorize', run.origin);
  authUrl.search = new URLSearchParams({
    client_id: credentials.id, redirect_uri: redirectUri, response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar', state
  });
  const page = await fetch(authUrl, { signal: AbortSignal.timeout(5_000) });
  assert.equal(page.status, 200, 'synthetic authorization page');
  const nonce = (await page.text()).match(/name="consent" value="([^"]+)"/)?.[1];
  assert(nonce, 'synthetic consent nonce');
  const decision = await fetch(`${run.origin}/oauth/authorize`, {
    method: 'POST', redirect: 'manual', headers: { origin: run.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ consent: nonce, user_id: userId, decision: 'approve' }), signal: AbortSignal.timeout(5_000)
  });
  assert.equal(decision.status, 302, 'synthetic consent accepted');
  const callback = new URL(decision.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get('state'), state);
  const code = callback.searchParams.get('code');
  assert(code, 'synthetic authorization code');
  const tokenResponse = await fetch(`${run.origin}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: credentials.id, client_secret: credentials.secret }), signal: AbortSignal.timeout(5_000)
  });
  assert.equal(tokenResponse.status, 200, 'synthetic token exchange');
  const { access_token: token } = await tokenResponse.json();
  assert(token, 'synthetic bearer token');
  return token;
}

test('saved checkpoint replays into a new OAuth identity with preserved data and lineage', { skip: process.env.CALENDARPIT_LIVE_TEST !== '1', timeout: 90_000 }, async () => {
  const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/calendars/ana.json', import.meta.url), 'utf8'));
  const redirectUri = 'http://127.0.0.1:4175/callback';
  const context = { scenarioId: 'ana', simulatedClock: '2026-11-02T00:00:00-03:00', timeZone: 'America/Sao_Paulo', generatorVersion: 'fixture-v1', seed: '0' };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'study-checkpoint-test-'));
  let first, second;
  try {
    first = await startCalendarExperiment({ fixture, redirectUri, context });
    const token1 = await syntheticToken(first, 'ana', redirectUri);
    const firstClient = first.provider(token1, async (_action, approval) => approval.decisionId === 'synthetic-approved');
    const domain=createDomainService();let event,firstEvent;
    try {
      const address=await domain.listen();
      const client=new DomainObservationClient(`http://127.0.0.1:${address.port}`);
      const observation=await observeCalendar({provider:firstClient,store:client,student:'ana',calendarId:'ana-calendar',timeMin:'2026-11-02T00:00:00-03:00',timeMax:'2026-11-09T00:00:00-03:00'});
      assert.equal(observation.version,1);
      assert.equal(observation.payload.calendarId,'ana-calendar');
      assert(observation.payload.events.length>0);
      assert(observation.payload.busy.length>0);
      assert(observation.payload.events.every(event=>event.etag));
      assert.equal((await client.currentVersions('ana')).calendar,1);
      await client.request('ana','revisions/context',{expectedVersion:0,payload:{synthetic:true}});
      await client.request('ana','revisions/evidence',{expectedVersion:0,payload:{sources:[]}});
      const base=Date.parse(observation.payload.timeMin),busy=observation.payload.busy;
      let start;
      for(let i=8;i<7*24-1;i++){
        const candidate=base+i*3600000;
        if(!busy.some(b=>candidate<Date.parse(b.end)&&Date.parse(b.start)<candidate+3600000)){start=candidate;break;}
      }
      assert(start,'one synthetic free hour exists');
      event={id:'abcde0123456',summary:'Synthetic checkpoint study',description:'Retain this note',start:{dateTime:new Date(start).toISOString()},end:{dateTime:new Date(start+3600000).toISOString()},extendedProperties:{private:{studyDemo:'true',student:'ana'}}};
      const action={type:'create',calendarId:'ana-calendar',event};
      const proposal=await client.request('ana','proposals',{versions:await client.currentVersions('ana'),payload:{sections:{near:{action}}}});
      const apply=()=>applyApprovedCreate({domain:client,student:'ana',proposalId:proposal.id,section:'near',action,origin:first.origin,accessToken:token1});
      await assert.rejects(apply,/not approved/);
      await client.request('ana',`proposals/${proposal.id}/decisions`,{section:'near',choice:'approve'});
      const applied=await apply();
      assert.equal(applied.state,'completed',JSON.stringify(applied.result));
      assert.equal(applied.result.createdEventId,event.id);
      assert.equal(applied.result.actualState.events.find(e=>e.id===event.id).description,event.description);
      assert.equal((await client.currentVersions('ana')).calendar,2);
      await assert.rejects(apply,/STALE|already claimed/);
      firstEvent=await firstClient.getEvent('ana-calendar',event.id);
    } finally { await domain.close(); }
    const checkpoint = await first.checkpoint();
    const saved = JSON.stringify(checkpoint, null, 2);
    assert(!saved.includes(token1), 'access token excluded from saved bundle');
    assert(!saved.includes(first.syntheticCredentials().secret), 'synthetic client secret excluded from saved bundle');
    const file = path.join(temporary, 'checkpoint.json');
    await fs.writeFile(file, saved, { mode: 0o600 });
    second = await replayCalendarExperiment({ checkpoint: JSON.parse(await fs.readFile(file, 'utf8')), redirectUri });
    assert.notEqual(second.runId, first.runId);
    assert.notEqual(second.origin, first.origin);
    assert(first.syntheticCredentials().secret !== second.syntheticCredentials().secret, 'fresh synthetic client credentials');
    const token2 = await syntheticToken(second, 'ana', redirectUri);
    assert(token1 !== token2, 'fresh synthetic access token');
    const secondClient = second.provider(token2);
    const replayed = await secondClient.getEvent('ana-calendar', event.id);
    assert.equal(replayed.id, firstEvent.id);
    assert.equal(replayed.summary, event.summary);
    assert.equal(replayed.description, event.description);
    assert.equal(replayed.extendedProperties.private.studyDemo, 'true');
    assert.notEqual(replayed.etag, firstEvent.etag);
    const page = await secondClient.listEvents('ana-calendar', { timeMin: '2026-11-02T00:00:00-03:00', timeMax: '2026-11-09T00:00:00-03:00' });
    assert(page.items.some(item => item.id === event.id));
    const wrongTokenClient = second.provider(token1);
    await assert.rejects(() => wrongTokenClient.getEvent('ana-calendar', event.id), error => error instanceof CalendarApiError && error.status === 401);
    const child = await second.checkpoint();
    assert.equal(child.lineage.parentCheckpointId, checkpoint.checkpointId);
    assert.equal(child.lineage.runId, second.runId);
  } finally {
    const results = await Promise.allSettled([first?.close(), second?.close(), fs.rm(temporary, { recursive: true, force: true })]);
    const failure = results.find(item => item.status === 'rejected');
    if (failure) throw failure.reason;
  }
});
