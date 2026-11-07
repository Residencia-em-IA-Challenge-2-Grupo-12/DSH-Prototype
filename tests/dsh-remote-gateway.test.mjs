import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestHost } from '../experiments/dsh-calendar-sidebar/calendar-host.mjs';

test('pinned DSH gateway dispatch, rejection, and service disposal (SRC mode)', async t => {
  const { root, markers, dispose, disposeCalendar } = await createTestHost();
  t.after(dispose);
  assert.deepEqual(markers.map(marker => marker.method), ['read']);
  const peer = { principal: { kind: 'owner' }, signal: new AbortController().signal };
  const request = { namespace: 'calendarSpike', method: 'read', args: { scenarioId: 'fixture-a' }, peer };
  const response = await root.typertGateway.invoke(request);
  assert.deepEqual(response, { scenarioId: 'fixture-a', events: [{ id: 'test-event', summary: 'Synthetic class' }] });
  response.events[0].summary = 'changed';
  assert.equal((await root.typertGateway.invoke(request)).events[0].summary, 'Synthetic class');
  await assert.rejects(root.typertGateway.invoke({ ...request, peer: { principal: { kind: 'untrusted', id: 'other' }, signal: new AbortController().signal } }), e => e.code === 'remote-access/denied');
  await assert.rejects(root.typertGateway.invoke({ ...request, args: { scenarioId: 'fixture-a', extra: true } }), e => ['gateway/arguments-invalid', 'gateway/bad-request'].includes(e.code));
  await assert.rejects(root.typertGateway.invoke({ ...request, args: { scenarioId: '../../host' } }), /Unknown synthetic scenario/);
  await assert.rejects(root.typertGateway.invoke({ ...request, method: 'write' }), e => e.code === 'gateway/invocation-unavailable');
  await disposeCalendar();
  await assert.rejects(root.typertGateway.invoke(request), e => e.code === 'gateway/invocation-unavailable');
});
