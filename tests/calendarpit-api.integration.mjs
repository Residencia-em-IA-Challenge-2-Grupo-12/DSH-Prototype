// CALENDARPIT_LIVE_TEST=1 node --test --test-isolation=none tests/calendarpit-api.integration.mjs
// Uses a disposable Calendarpit container and synthetic consent only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { CalendarpitApi, CalendarApiError } from '../src/foundation/calendarpit-api.mjs';
import { startCalendarpitRun } from '../src/foundation/calendarpit-runner.mjs';

async function syntheticToken(run, userId, redirectUri) {
  const state = randomBytes(16).toString('hex');
  const authUrl = new URL('/oauth/authorize', run.origin);
  authUrl.search = new URLSearchParams({
    client_id: run.client.id, redirect_uri: redirectUri, response_type: 'code',
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
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: run.client.id, client_secret: run.client.secret }), signal: AbortSignal.timeout(5_000)
  });
  assert.equal(tokenResponse.status, 200, 'synthetic token exchange');
  const { access_token: token } = await tokenResponse.json();
  assert(token, 'synthetic bearer token');
  return token;
}

test('synthetic OAuth supports v3 reads and reviewed ETag-protected event writes', { skip: process.env.CALENDARPIT_LIVE_TEST !== '1', timeout: 60_000 }, async () => {
  const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/calendars/ana.json', import.meta.url), 'utf8'));
  const redirectUri = 'http://127.0.0.1:4175/callback';
  const run = await startCalendarpitRun({ fixture, redirectUri });
  try {
    const token = await syntheticToken(run, 'ana', redirectUri);
    const client = new CalendarpitApi({ origin: run.origin, accessToken: token, authorizeWrite: async (_action, approval) => approval.decisionId === 'test-approved' });
    const approval = { decisionId: 'test-approved' };
    const calendarId = 'ana-calendar';
    const existing = await client.listEvents(calendarId, { timeMin: '2026-11-02T00:00:00-03:00', timeMax: '2026-11-09T00:00:00-03:00' });
    assert(existing.items.length > 0);
    const busy = await client.freeBusy({ timeMin: '2026-11-02T00:00:00-03:00', timeMax: '2026-11-09T00:00:00-03:00', calendarIds: [calendarId] });
    assert(Array.isArray(busy.calendars[calendarId].busy));
    const event = { id: 'aabbccddee2026', summary: 'Synthetic study', description: 'Keep this description', start: { dateTime: '2026-11-02T13:00:00-03:00' }, end: { dateTime: '2026-11-02T14:00:00-03:00' } };
    const created = await client.createApprovedEvent({ calendarId, event, approval });
    assert.equal(created.id, event.id);
    const observed = await client.getEvent(calendarId, event.id);
    assert(observed.etag);
    const patched = await client.patchApprovedEvent({ calendarId, eventId: event.id, etag: observed.etag, changes: { summary: 'Revised synthetic study' }, approval });
    assert.equal(patched.description, event.description);
    await assert.rejects(() => client.patchApprovedEvent({ calendarId, eventId: event.id, etag: observed.etag, changes: { summary: 'Stale write' }, approval }), error => error instanceof CalendarApiError && error.status === 412);
    await client.deleteApprovedEvent({ calendarId, eventId: event.id, etag: patched.etag, approval });
  } finally {
    await run.close();
  }
});
