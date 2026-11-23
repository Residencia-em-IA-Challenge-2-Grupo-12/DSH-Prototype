// Both callers supply independently validated proposals and a reviewed preference.
export function decideRoutinePreference(candidates, preference, date) {
  const byStudy = [...candidates].sort((left, right) => right.studyMinutes - left.studyMinutes);
  if (!byStudy.length) throw new Error('No feasible proposals are available for review');
  const recommend = (candidate, reason) => ({ action: 'recommend', candidateIds: [candidate.id], reason });
  if (!preference || date < preference.validFrom || date > preference.validThrough) {
    return recommend(byStudy[0], 'no_current_preference');
  }

  const protectedPlan = byStudy.find(candidate => candidate.protectedMinutes === 0);
  if (!protectedPlan) throw new Error('A plan protecting the reviewed time is required');
  if (preference.kind === 'hard') return recommend(protectedPlan, 'time_unavailable');
  if (protectedPlan.studyMinutes === byStudy[0].studyMinutes) return recommend(protectedPlan, 'no_study_time_cost');

  const leastImpact = [...byStudy].sort((left, right) =>
    right.studyMinutes - left.studyMinutes || left.protectedMinutes - right.protectedMinutes);
  if (preference.fallbackMinutes !== undefined) {
    const permitted = leastImpact.find(candidate => candidate.protectedMinutes <= preference.fallbackMinutes);
    return recommend(permitted, 'explicit_fallback');
  }
  return {
    action: 'ask',
    candidateIds: [protectedPlan.id, leastImpact[0].id],
    reason: 'unresolved_tradeoff',
  };
}
