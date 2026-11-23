// The check-in trial shares the managed run's database. Its records have no
// effect on the main planner and are never read from a different run.
export function createCheckinStorage(store, runId, student) {
  let generation = 0;
  function stored(state) {
    const value = state.checkinTrial;
    if (value && (value.schemaVersion !== 1 || value.runId !== runId ||
        !value.checkpoint || !Number.isSafeInteger(value.generation) || value.generation < 1)) {
      throw new Error('Saved check-in state does not match this run');
    }
    return value;
  }
  return {
    async load() {
      if (await store.getCalendarClaim()) throw new Error('A calendar operation is unresolved');
      const value = stored(await store.load(student));
      generation = value?.generation ?? 0;
      return value?.checkpoint ?? null;
    },
    async save(checkpoint) {
      const next = generation + 1;
      await store.update(student, state => {
        if ((stored(state)?.generation ?? 0) !== generation) throw new Error('Saved check-in state changed; reopen the run');
        state.checkinTrial = { schemaVersion: 1, runId, generation: next, checkpoint };
      }, { requiresIdle: true });
      generation = next;
    },
  };
}
