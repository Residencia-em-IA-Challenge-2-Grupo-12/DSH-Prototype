import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { coldStartStudents, validatePlanningContext, plannerProfileFromRecord, reviewedPlannerProfile } from './cold-start-context.mjs';
import {
  ROOT,
  FIXED_TODAY,
  Calendarpit,
  assertStudent,
  disposeSyntheticRuntime,
  getRecoveryClaim,
  loadState,
  readJSON,
  runtimeDir,
  saveState,
  snapshotForArchive,
  statePath,
  stateStore,
  withSyntheticRuntime,
  withWriteLock,
  writeJSON,
} from './domain/runtime.mjs';
import { getStudent, listWorkspace, readWorkspace } from './domain/workspace.mjs';
import { diffSnapshots, digest, makePlan, planScheduleDetails, significant, snapshot } from './domain/planner.mjs';
import { addFeedback, report, saveNarrative, summarize, validateFeedback } from './domain/reports.mjs';

export {
  ROOT,
  FIXED_TODAY,
  Calendarpit,
  assertStudent,
  disposeSyntheticRuntime,
  getRecoveryClaim,
  loadState,
  readJSON,
  runtimeDir,
  saveState,
  snapshotForArchive,
  statePath,
  withSyntheticRuntime,
  writeJSON,
  getStudent,
  listWorkspace,
  readWorkspace,
  diffSnapshots,
  digest,
  makePlan,
  significant,
  snapshot,
  addFeedback,
  report,
  saveNarrative,
  summarize,
  validateFeedback,
};

// Initializes an already-seeded, fresh synthetic run. It does not invoke the
// simulator's administrative reset endpoint or overwrite an existing run.
export async function initializeScenario(calendar, student, { coldStart, workspaceSource, expectedEvents } = {}) {
  assertStudent(student);
  if (coldStart !== undefined) {
    if (workspaceSource) {
      if (typeof coldStart !== 'boolean' && (typeof coldStart !== 'string' || !coldStart.trim() || coldStart.length > 128)) {
        throw new Error('Invalid cold-start case identifier');
      }
    } else if (!Object.hasOwn(coldStartStudents, coldStart) || coldStartStudents[coldStart] !== student) {
      throw new Error('Unknown cold-start case for this student');
    }
  }
  try {
    await loadState(student);
    throw new Error('Synthetic scenario already initialized');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const events = await calendar.events(student);
  const expected = expectedEvents ?? (await readJSON(path.join(ROOT, 'fixtures/calendars', `${student}.json`))).events;
  if (digest(events) !== digest(expected)) throw new Error('Observed calendar does not match the synthetic fixture');

  const staged = path.join(runtimeDir(), 'workspaces', student);
  await fs.mkdir(path.dirname(staged), { recursive: true });
  try {
    await fs.mkdir(staged);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Synthetic workspace already initialized');
    throw error;
  }
  const source = workspaceSource || (
    coldStart === 'ana-held-out'
      ? path.join(ROOT, 'fixtures/paired-replay/ana-held-out/workspace')
      : coldStart === undefined
        ? path.join(ROOT, 'fixtures/students', student)
        : path.join(ROOT, 'fixtures/cold-start', coldStart)
  );
  await fs.cp(source, staged, { recursive: true, force: false, errorOnExist: true });

  const feedback = (await readJSON(path.join(ROOT, 'fixtures/feedback', `${student}.json`))).map(validateFeedback);
  const state = { student, feedback, history: [], plan: null, lastSnapshot: snapshot(events), annotations: {}, protectedIds: [] };
  if (coldStart !== undefined) {
    state.planningContext = {
      ...(typeof coldStart === 'string' ? { caseId: coldStart } : {}),
      pending: null,
      confirmed: null,
    };
  }
  await stateStore.create(student, state);
  return state;
}

export async function resetScenario(calendar, student) {
  assertStudent(student);
  const id = randomUUID();
  const actionId = `reset:${student}`;
  await stateStore.acquireCalendarClaim({ id, student, kind: 'reset', actions: [{ actionId }], startedAt: new Date().toISOString() });
  try {
    await stateStore.appendCalendarClaimStep(id, { actionId, status: 'sent' });
    await calendar.reset(student);
    await stateStore.appendCalendarClaimStep(id, { actionId, status: 'acknowledged' });
    const staged = path.join(runtimeDir(), 'workspaces', student);
    await fs.rm(staged, { recursive: true, force: true });
    await fs.mkdir(path.dirname(staged), { recursive: true });
    await fs.cp(path.join(ROOT, 'fixtures/students', student), staged, { recursive: true });
    const events = await calendar.events(student);
    const expected = (await readJSON(path.join(ROOT, 'fixtures/calendars', `${student}.json`))).events;
    if (digest(events) !== digest(expected)) throw new Error('Observed calendar does not match the reset fixture');
    const feedback = (await readJSON(path.join(ROOT, 'fixtures/feedback', `${student}.json`))).map(validateFeedback);
    const state = { student, feedback, history: [], plan: null, lastSnapshot: snapshot(events), annotations: {}, protectedIds: [] };
    await stateStore.appendCalendarClaimStep(id, { actionId, status: 'confirmed' });
    await stateStore.completeCalendarClaim(id, { student, replacement: state });
    return state;
  } catch (error) {
    throw new Error(`RESET UNRESOLVED: synthetic simulator or workspace may have changed; do not retry blindly. ${error.message}`);
  }
}

export async function readPlanningContext(student) {
  const context = (await loadState(student)).planningContext;
  if (!context) throw new Error('Planning context review is available for cold-start exercises');
  return context;
}

export async function proposePlanningContext(student, value, { today = FIXED_TODAY } = {}) {
  await readPlanningContext(student);
  const record = await validatePlanningContext(value, file => readWorkspace(student, file, { requireStaged: true }), today);
  const revision = { id: randomUUID(), record };
  return stateStore.update(student, state => {
    const context = state.planningContext;
    context.previous = context.pending || context.confirmed;
    context.pending = revision;
    return revision;
  }, { requiresIdle: true });
}

// Only the operator-facing controller calls this. It is absent from the broker.
export async function confirmPlanningContext(student, revisionId, operatorReplies) {
  if (
    !Array.isArray(operatorReplies) ||
    operatorReplies.length < 1 ||
    operatorReplies.length > 20 ||
    operatorReplies.some(value => typeof value !== 'string' || !value.trim() || value.length > 2000)
  ) {
    throw new Error('Provide the original operator replies for review');
  }
  return stateStore.update(assertStudent(student), state => {
    const context = state.planningContext;
    if (!context?.pending || context.pending.id !== revisionId) {
      throw new Error('Planning context revision changed; review again');
    }
    context.confirmed = { ...context.pending, operatorReplies: [...operatorReplies], confirmedAt: new Date().toISOString() };
    context.pending = null;
    state.plan = null;
    state.history.push({ type: 'planning_context_confirmed', revisionId, at: context.confirmed.confirmedAt });
    return context.confirmed;
  }, { requiresIdle: true });
}

function computeProtectedIds(state, events) {
  const unseen = diffSnapshots(state.lastSnapshot, events);
  return [
    ...new Set([
      ...(state.protectedIds || []),
      ...unseen.filter(change => change.before?.extendedProperties?.private?.studyDemo === 'true').map(change => change.id),
    ]),
  ];
}

function buildPlanOptions(options, { effectiveToday, protectedIds, enforcedHours }) {
  const { record: _ignoredRecord, ...rest } = options || {};
  return {
    ...rest,
    today: options?.today ?? effectiveToday,
    ...(enforcedHours !== undefined ? { hours: enforcedHours } : {}),
    protectedIds,
  };
}

export async function previewPlan(calendar, student, options = {}, { requireStaged = false, today = FIXED_TODAY } = {}) {
  const state = await loadState(assertStudent(student));
  const events = await calendar.events(student);
  const context = state.planningContext;
  const effectiveToday = options?.today ?? today;
  const hasCandidateRecord = options?.record !== undefined;
  let profile;
  let planningContextRevisionId = null;
  let enforceTargetHours = false;

  if (hasCandidateRecord) {
    const record = await validatePlanningContext(
      options.record,
      file => readWorkspace(student, file, { requireStaged }),
      effectiveToday,
    );
    profile = plannerProfileFromRecord(student, record, effectiveToday);
    enforceTargetHours = true;
  } else if (context) {
    if (context.pending) throw new Error('The operator must review the pending planning context revision');
    profile = reviewedPlannerProfile(student, context, effectiveToday);
    planningContextRevisionId = context.confirmed.id;
    enforceTargetHours = true;
  } else {
    profile = await getStudent(student, { requireStaged });
  }

  if (enforceTargetHours && options?.hours !== undefined && options.hours !== profile.targetHours) {
    throw new Error('Review a new planning context to change the confirmed hours');
  }

  const protectedIds = computeProtectedIds(state, events);
  const result = planScheduleDetails(
    profile,
    events,
    buildPlanOptions(options, {
      effectiveToday,
      protectedIds,
      enforcedHours: enforceTargetHours ? profile.targetHours : undefined,
    }),
  );
  if (planningContextRevisionId) result.plan.planningContextRevisionId = planningContextRevisionId;
  return {
    ok: result.ok,
    plan: result.plan,
    horizon: result.horizon,
    capacityPerWeek: result.capacityPerWeek,
    planningContextRevisionId,
    findings: result.findings,
  };
}

export async function draft(calendar, student, options = {}, { requireStaged = false, today = FIXED_TODAY } = {}) {
  const coldStart = (await loadState(student)).planningContext;
  const events = await calendar.events(student);
  const baseline = coldStart ? null : await getStudent(student, { requireStaged });
  return stateStore.update(assertStudent(student), state => {
    const context = state.planningContext;
    if (context?.pending) throw new Error('The operator must review the pending planning context revision');
    const effectiveToday = options?.today ?? today;
    const profile = context ? reviewedPlannerProfile(student, context, effectiveToday) : baseline;
    if (context && options.hours !== undefined && options.hours !== profile.targetHours) {
      throw new Error('Review a new planning context to change the confirmed hours');
    }
    const protectedIds = computeProtectedIds(state, events);
    state.protectedIds = protectedIds;
    const plan = makePlan(
      profile,
      events,
      buildPlanOptions(options, {
        effectiveToday,
        protectedIds,
        enforcedHours: context ? profile.targetHours : undefined,
      }),
    );
    if (context) plan.planningContextRevisionId = context.confirmed.id;
    state.plan = plan;
    state.history.push({ type: 'proposal', at: new Date().toISOString(), planId: plan.id, options });
    return plan;
  }, { requiresIdle: true });
}

export async function applyApproved(calendar, student, planId, section) {
  return withWriteLock(student, () => applyApprovedLocked(calendar, student, planId, section));
}

async function applyApprovedLocked(calendar, student, planId, section) {
  if (!['near', 'future'].includes(section)) throw new Error('Unknown approval section');
  const state = await loadState(student);
  const plan = state.plan;
  if (!plan || plan.id !== planId || plan.status[section] !== 'pending') throw new Error('Proposal not pending');
  if (state.planningContext?.pending) throw new Error('STALE: review the pending planning context revision');
  const current = await calendar.events(student);
  if (digest(current) !== plan.baseHash) throw new Error('STALE: calendar changed; review a new proposal');

  const claimId = randomUUID();
  const actions = [
    ...(plan.remove?.[section] || []).map(event => ({ actionId: `remove:${event.id}`, type: 'remove', event })),
    ...plan[section].map(event => ({ actionId: `create:${event.id}`, type: 'create', event })),
  ];
  await stateStore.acquireCalendarClaim(
    {
      id: claimId,
      student,
      kind: 'approval',
      proposalId: planId,
      section,
      proposal: plan,
      actions,
      decision: { kind: 'approved', section, at: new Date().toISOString() },
      startedAt: new Date().toISOString(),
    },
    {
      student,
      change: latest => {
        if (latest.planningContext?.pending) throw new Error('STALE: review the pending planning context revision');
        if (JSON.stringify(latest.plan) !== JSON.stringify(plan) || latest.plan?.status[section] !== 'pending') {
          throw new Error('Proposal not pending');
        }
        latest.plan.status[section] = 'applying';
      },
    },
  );

  const written = [];
  const removed = [];
  let expected = plan.baseHash;
  let expectedEvents = current;
  let after;
  let attempt = null;
  let sent = false;
  try {
    for (const old of plan.remove?.[section] || []) {
      if (digest(await calendar.events(student)) !== expected) throw new Error('Calendar changed during application');
      attempt = { type: 'remove', id: old.id };
      const actionId = `remove:${old.id}`;
      await stateStore.appendCalendarClaimStep(claimId, { actionId, status: 'sent' });
      sent = true;
      await calendar.remove(student, old.id);
      removed.push(old.id);
      attempt = null;
      await stateStore.appendCalendarClaimStep(claimId, { actionId, status: 'acknowledged' });
      expectedEvents = expectedEvents.filter(event => event.id !== old.id);
      const observed = await calendar.events(student);
      if (digest(observed) !== digest(expectedEvents)) throw new Error('Calendar changed during application');
      await stateStore.appendCalendarClaimStep(claimId, { actionId, status: 'confirmed' });
      expectedEvents = observed;
      expected = digest(observed);
    }
    for (const block of plan[section]) {
      if (digest(await calendar.events(student)) !== expected) throw new Error('Calendar changed during application');
      attempt = { type: 'create', id: block.id };
      const actionId = `create:${block.id}`;
      await stateStore.appendCalendarClaimStep(claimId, { actionId, status: 'sent' });
      sent = true;
      const result = await calendar.create(student, block);
      written.push(result.id);
      attempt = null;
      await stateStore.appendCalendarClaimStep(claimId, { actionId, status: 'acknowledged', resultId: result.id });
      expectedEvents = [...expectedEvents, result];
      const observed = await calendar.events(student);
      if (digest(observed) !== digest(expectedEvents)) throw new Error('Calendar changed during application');
      await stateStore.appendCalendarClaimStep(claimId, { actionId, status: 'confirmed' });
      expectedEvents = observed;
      expected = digest(observed);
    }
    after = await calendar.events(student);
    if (digest(after) !== expected) throw new Error('Calendar changed during application');
  } catch (err) {
    if (!sent) {
      await stateStore.cancelCalendarClaim(claimId, {
        student,
        change: latest => {
          if (latest.plan?.id === planId && latest.plan.status[section] === 'applying') latest.plan.status[section] = 'pending';
        },
      });
      throw err;
    }
    let observed = null;
    try {
      observed = await calendar.events(student);
    } catch {
      /* Preserve the last trusted snapshot. */
    }
    await stateStore.update(assertStudent(student), latest => {
      if (latest.plan?.id === planId) latest.plan.status[section] = 'partial';
      if (observed) {
        const edited = diffSnapshots(latest.lastSnapshot, observed).filter(
          change => change.before?.extendedProperties?.private?.studyDemo === 'true' && !removed.includes(change.id),
        );
        latest.protectedIds = [...new Set([...(latest.protectedIds || []), ...edited.map(change => change.id)])];
      }
      latest.history.push({
        type: 'partial-write',
        section,
        at: new Date().toISOString(),
        planId,
        written,
        removed,
        error: String(err),
        observation: observed ? 'available' : 'unavailable',
        ...(observed ? { observedSnapshot: snapshot(observed) } : {}),
        ...(attempt ? { unknownAction: attempt } : {}),
      });
    });
    throw new Error(
      `PARTIAL: created ${JSON.stringify(written)}; removed ${JSON.stringify(removed)}` +
        `${attempt ? `; outcome unknown for ${JSON.stringify(attempt)}` : ''}. ` +
        `${observed ? 'Inspect calendar before retry.' : 'Calendar observation unavailable; inspect when available.'} ${err.message}`,
    );
  }

  await stateStore.completeCalendarClaim(claimId, {
    student,
    change: latest => {
      if (latest.plan?.id !== planId || latest.plan.status[section] !== 'applying') {
        throw new Error('Approved proposal changed while applying');
      }
      latest.plan.status[section] = 'applied';
      latest.plan.baseHash = digest(after);
      latest.lastSnapshot = snapshot(after);
      latest.history.push({ type: 'approved', section, at: new Date().toISOString(), planId, written, removed });
    },
  });
  return { written, removed, section };
}

export async function checkpoint(calendar, student, reason = '') {
  const current = await calendar.events(student);
  return stateStore.update(assertStudent(student), state => {
    const changes = diffSnapshots(state.lastSnapshot, current);
    state.protectedIds = [
      ...new Set([
        ...(state.protectedIds || []),
        ...changes.filter(change => change.before?.extendedProperties?.private?.studyDemo === 'true').map(change => change.id),
      ]),
    ];
    state.history.push({ type: 'checkpoint', at: new Date().toISOString(), reason, changes });
    state.lastSnapshot = snapshot(current);
    return { changes, reason };
  }, { requiresIdle: true });
}

export async function draftAnnotation(calendar, student, eventId, category) {
  if (!['study', 'classes', 'work', 'rest', 'physical', 'other', 'unknown'].includes(category)) {
    throw new Error('Invalid category');
  }
  const events = await calendar.events(student);
  const event = events.find(item => item.id === eventId);
  if (!event) throw new Error('Event not found');
  const start = '[Study Atlas]';
  const end = '[/Study Atlas]';
  const original = event.description || '';
  const preserved = original.replace(/\n?\[Study Atlas\][\s\S]*?\[\/Study Atlas\]/g, '').trimEnd();
  const section = `${start}\nCategory / Categoria: ${category}\n${end}`;
  const description = (preserved ? `${preserved}\n\n` : '') + section;
  return stateStore.update(assertStudent(student), state => {
    state.pendingAnnotation = {
      id: randomUUID(),
      eventId,
      category,
      baseHash: digest(events),
      before: significant(event),
      after: {
        description,
        extendedProperties: {
          ...(event.extendedProperties || {}),
          private: { ...(event.extendedProperties?.private || {}), studyCategory: category },
        },
      },
    };
    return state.pendingAnnotation;
  }, { requiresIdle: true });
}

export async function applyAnnotation(calendar, student, id) {
  return withWriteLock(student, () => applyAnnotationLocked(calendar, student, id));
}

async function applyAnnotationLocked(calendar, student, id) {
  const state = await loadState(student);
  const pending = state.pendingAnnotation;
  if (!pending || pending.id !== id || (pending.status && pending.status !== 'pending')) {
    throw new Error('Annotation proposal not pending');
  }
  const events = await calendar.events(student);
  if (digest(events) !== pending.baseHash) throw new Error('STALE: calendar changed; review again');

  const claimId = randomUUID();
  const actionId = `patch:${pending.eventId}`;
  await stateStore.acquireCalendarClaim(
    {
      id: claimId,
      student,
      kind: 'annotation',
      proposalId: id,
      proposal: pending,
      decision: { kind: 'approved', at: new Date().toISOString() },
      actions: [{ actionId, type: 'patch', eventId: pending.eventId, before: pending.before, after: pending.after }],
      startedAt: new Date().toISOString(),
    },
    {
      student,
      change: latest => {
        if (JSON.stringify(latest.pendingAnnotation) !== JSON.stringify(pending)) {
          throw new Error('Annotation proposal not pending');
        }
        latest.pendingAnnotation.status = 'applying';
      },
    },
  );

  let acknowledged = false;
  let after;
  let sent = false;
  try {
    if (digest(await calendar.events(student)) !== pending.baseHash) throw new Error('STALE: calendar changed; review again');
    await stateStore.appendCalendarClaimStep(claimId, { actionId, status: 'sent' });
    sent = true;
    await calendar.patch(student, pending.eventId, pending.after);
    acknowledged = true;
    await stateStore.appendCalendarClaimStep(claimId, { actionId, status: 'acknowledged' });
    after = await calendar.events(student);
    const expected = events.map(event => (event.id === pending.eventId ? { ...event, ...pending.after } : event));
    if (digest(after) !== digest(expected)) throw new Error('Calendar changed during annotation');
    await stateStore.appendCalendarClaimStep(claimId, { actionId, status: 'confirmed' });
  } catch (error) {
    if (!sent) {
      await stateStore.cancelCalendarClaim(claimId, {
        student,
        change: latest => {
          if (latest.pendingAnnotation?.id === id) latest.pendingAnnotation = pending;
        },
      });
      throw error;
    }
    let observed = null;
    try {
      observed = await calendar.events(student);
    } catch {
      /* Keep the last trusted snapshot. */
    }
    await stateStore.update(assertStudent(student), latest => {
      if (latest.pendingAnnotation?.id === id) latest.pendingAnnotation.status = 'partial';
      if (observed) {
        const edited = diffSnapshots(latest.lastSnapshot, observed).filter(
          change => change.before?.extendedProperties?.private?.studyDemo === 'true',
        );
        latest.protectedIds = [...new Set([...(latest.protectedIds || []), ...edited.map(change => change.id)])];
      }
      latest.history.push({
        type: 'annotation-partial',
        proposalId: id,
        eventId: pending.eventId,
        at: new Date().toISOString(),
        acknowledged,
        observation: observed ? 'available' : 'unavailable',
        ...(observed ? { observedSnapshot: snapshot(observed) } : {}),
        error: String(error),
      });
    });
    throw new Error(`PARTIAL: annotation ${acknowledged ? 'acknowledged; resulting calendar needs review' : 'outcome unknown'}. ${error.message}`);
  }

  await stateStore.completeCalendarClaim(claimId, {
    student,
    change: latest => {
      if (latest.pendingAnnotation?.id !== id || latest.pendingAnnotation.status !== 'applying') {
        throw new Error('Annotation proposal changed while applying');
      }
      latest.annotations[pending.eventId] = { category: pending.category, source: 'user-confirmed', at: new Date().toISOString() };
      latest.pendingAnnotation = null;
      latest.history.push({ type: 'annotation-approved', eventId: pending.eventId, category: pending.category, at: new Date().toISOString() });
      latest.lastSnapshot = snapshot(after);
    },
  });
  return { saved: true };
}
