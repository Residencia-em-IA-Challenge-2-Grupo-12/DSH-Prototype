import assert from 'node:assert/strict';
import test from 'node:test';
import { formControl, packet, score } from '../experiments/routine-preference/experiment.mjs';

const decision = (id, action, candidateIds) => ({ caseId: packet(id).caseId, action, candidateIds, message: 'Review the selected candidates.' });
const cases = ['no-cost', 'needs-choice', 'bounded-fallback', 'hard-limit', 'expired'];
const minutes = id => packet(id).candidates.map(candidate => [candidate.studyMinutes, candidate.wednesdayMinutes]);

test('routine-preference packets contain verified plans and keep scoring keys private', () => {
  assert.deepEqual(minutes('no-cost'), [[240, 120], [240, 0], [240, 60]]);
  assert.deepEqual(minutes('needs-choice'), [[240, 120], [180, 0], [240, 60]]);
  assert.deepEqual(minutes('hard-limit'), [[180, 0]]);
  assert.deepEqual(packet('no-cost'), packet('no-cost'));
  for (const id of cases) {
    assert.match(packet(id).caseId, /^rp-\d{2}$/);
    assert.doesNotMatch(JSON.stringify(packet(id)), new RegExp('"' + id + '"'));
    assert.doesNotMatch(JSON.stringify(packet(id)), /formPreference|fallbackMinutes|actionAndCandidates/);
  }
});

test('a rule-based form and judged model decisions can be compared on the same frozen candidates', () => {
  for (const id of cases) {
    assert.equal(score(id, { ...decision(id), ...formControl(id) }).actionAndCandidates, 'pass', id);
  }
  assert.equal(score('needs-choice', decision('needs-choice', 'recommend', ['one-hour-wednesday'])).actionAndCandidates, 'fail');
  assert.equal(score('hard-limit', decision('hard-limit', 'recommend', ['protect-wednesday'])).explanationReview, 'pending');
  assert.equal(score('expired', decision('expired', 'recommend', ['protect-wednesday'])).actionAndCandidates, 'fail');
  assert.throws(() => score('hard-limit', decision('hard-limit', 'recommend', ['flexible'])), /valid action/);
  assert.throws(() => score('hard-limit', decision('expired', 'recommend', ['protect-wednesday'])), /case ID/);
});

test('reviewed routine policy asks only when a current preference leaves a materially better fallback open', async () => {
  const { decideRoutinePreference } = await import('../experiments/routine-preference/decision.mjs');
  const candidates = [
    { id: 'usual', studyMinutes: 240, protectedMinutes: 120 },
    { id: 'free', studyMinutes: 180, protectedMinutes: 0 },
    { id: 'one', studyMinutes: 240, protectedMinutes: 60 },
  ];
  const reviewed = { kind: 'soft', validFrom: '2026-11-02', validThrough: '2026-11-08' };
  const date = '2026-11-02';
  assert.deepEqual(decideRoutinePreference(candidates, reviewed, date), {
    action: 'ask', candidateIds: ['free', 'one'], reason: 'unresolved_tradeoff',
  });
  assert.deepEqual(decideRoutinePreference(candidates, { ...reviewed, fallbackMinutes: 60 }, date), {
    action: 'recommend', candidateIds: ['one'], reason: 'explicit_fallback',
  });
  assert.deepEqual(decideRoutinePreference(candidates, { ...reviewed, fallbackMinutes: 0 }, date), {
    action: 'recommend', candidateIds: ['free'], reason: 'explicit_fallback',
  });
  assert.deepEqual(decideRoutinePreference(candidates, { ...reviewed, validFrom: '2026-10-26', validThrough: '2026-11-01' }, date), {
    action: 'recommend', candidateIds: ['usual'], reason: 'no_current_preference',
  });
});
