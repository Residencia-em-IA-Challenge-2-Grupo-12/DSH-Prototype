import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarpitApi, CalendarApiError } from '../src/foundation/calendarpit-api.mjs';

function stub() {
  const calls = [];
  let response = { status: 200, ok: true, json: async () => ({ items: [], nextPageToken: 'next' }) };
  return { calls, fetchImpl: async (url, options) => { calls.push({ url, options }); return response; }, setResponse: value => { response = value; } };
}
const origin = 'http://127.0.0.1:4173';
const accessToken = 'temporary-synthetic-token';
const approval = { decisionId: 'approved-1', proposalId: 'proposal-1' };

test('reads use provider endpoints and preserve page and per-calendar error information', async () => {
  const fake = stub();
  const client = new CalendarpitApi({ origin, accessToken, fetchImpl: fake.fetchImpl });
  const page = await client.listEvents('student@example.test', { timeMin: '2026-11-02T00:00:00Z', timeMax: '2026-11-09T00:00:00Z', singleEvents: true });
  assert.equal(page.nextPageToken, 'next');
  const requested = new URL(fake.calls[0].url);
  assert.equal(requested.pathname, '/calendar/v3/calendars/student%40example.test/events');
  assert.equal(requested.searchParams.get('singleEvents'), 'true');
  assert.equal(fake.calls[0].options.headers.authorization, `Bearer ${accessToken}`);
  await client.getEvent('cal', 'event-1');
  fake.setResponse({ status: 200, ok: true, json: async () => ({ calendars: { cal: { errors: [{ reason: 'notFound' }] } } }) });
  const busy = await client.freeBusy({ timeMin: '2026-11-02T00:00:00Z', timeMax: '2026-11-09T00:00:00Z', calendarIds: ['cal'] });
  assert.equal(busy.calendars.cal.errors[0].reason, 'notFound');
  assert.equal(new URL(fake.calls[2].url).pathname, '/calendar/v3/freeBusy');
  assert.equal(fake.calls[2].options.method, 'POST');
  assert(!fake.calls.some(call => call.url.includes('__calendarpit')));
  assert(!JSON.stringify(client).includes(accessToken));
});

test('writes require approval bound to the complete action and a specific ETag', async () => {
  const fake = stub();
  const approvals = [];
  const client = new CalendarpitApi({ origin, accessToken, fetchImpl: fake.fetchImpl, authorizeWrite: async (action, decision) => { approvals.push({ action, decision }); return decision.decisionId === 'approved-1'; } });
  await client.createApprovedEvent({ calendarId: 'cal', event: { id: 'event-1', summary: 'Study' }, approval });
  await client.patchApprovedEvent({ calendarId: 'cal', eventId: 'event-1', etag: '"v1"', changes: { summary: 'Revised' }, approval });
  fake.setResponse({ status: 204, ok: true });
  await client.deleteApprovedEvent({ calendarId: 'cal', eventId: 'event-1', etag: '"v2"', approval });
  assert.deepEqual(approvals.map(item => item.action.type), ['create', 'patch', 'delete']);
  assert.equal(approvals[1].action.changes.summary, 'Revised');
  assert.equal(fake.calls[1].options.headers['if-match'], '"v1"');
  assert.equal(fake.calls[2].options.headers['if-match'], '"v2"');
  assert.equal(fake.calls[0].options.method, 'POST');
  assert.equal(fake.calls[1].options.method, 'PATCH');
  assert.equal(fake.calls[2].options.method, 'DELETE');
  const count = fake.calls.length;
  await assert.rejects(() => client.createApprovedEvent({ calendarId: 'cal', event: { id: 'event-2' } }), /Explicit approval/);
  await assert.rejects(() => client.createApprovedEvent({ calendarId: 'cal', event: { id: 'event-2' }, approval: { decisionId: 'no' } }), /rejected/);
  await assert.rejects(() => client.patchApprovedEvent({ calendarId: 'cal', eventId: 'event-1', etag: ' * ', changes: {}, approval }), /specific/);
  await assert.rejects(() => client.deleteApprovedEvent({ calendarId: 'cal', eventId: 'event-1', approval }), /ETag/);
  assert.equal(fake.calls.length, count);
});

test('provider stale responses propagate without leaking tokens, and invalid origins and paths are rejected', async () => {
  const fake = stub();
  fake.setResponse({ status: 412, ok: false });
  const client = new CalendarpitApi({ origin, accessToken, fetchImpl: fake.fetchImpl, authorizeWrite: async () => true });
  await assert.rejects(() => client.patchApprovedEvent({ calendarId: 'cal', eventId: 'event', etag: '"old"', changes: { summary: 'x' }, approval }), error => error instanceof CalendarApiError && error.status === 412 && !error.message.includes(accessToken));
  assert.throws(() => new CalendarpitApi({ origin: 'http://example.com:4173', accessToken }), /localhost/);
  assert.throws(() => new CalendarpitApi({ origin: 'http://127.0.0.1:4173/__calendarpit', accessToken }), /localhost/);
  await assert.rejects(() => client.getEvent('../__calendarpit', 'event'), /Invalid/);
  await assert.rejects(() => client.listEvents('cal', { arbitrary: true }), /Unsupported/);
});

test('the approved event payload cannot change while its decision is being checked', async () => {
  const fake = stub();
  const event = { id: 'event', summary: 'Approved' };
  const client = new CalendarpitApi({ origin, accessToken, fetchImpl: fake.fetchImpl, authorizeWrite: async action => { event.summary = 'Changed'; action.event.summary = 'Tampered verifier copy'; return true; } });
  await client.createApprovedEvent({ calendarId: 'cal', event, approval });
  assert.equal(JSON.parse(fake.calls[0].options.body).summary, 'Approved');
});
