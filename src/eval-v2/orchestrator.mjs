import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  disposeSyntheticRuntime, initializeScenario, previewPlan, withSyntheticRuntime,
} from '../core.mjs';
import { ROOT, timezoneOffsetForDate } from '../domain/runtime.mjs';
import { digest } from '../domain/planner.mjs';
import { createDisclosedSources } from '../cold-start-context.mjs';
import { createTrustedStudyService } from '../foundation/trusted-study-service.mjs';
import { z } from 'zod';
import { ARMS, createArmBridge, startArmSession } from './arms.mjs';
import { archetypes } from './case-schema.mjs';
import { checkRunnerPayload, hiddenMarkers, scanContamination } from './contamination.mjs';
import { buildBlindedPacket, createJudgeB2, JUDGE_MODELS } from './judge-b2.mjs';
import { EVAL_LIMITS } from '../runners/single-agent/eval-session.mjs';
import { createOperatorB1, createOperatorCache } from './operator-b1.mjs';
import { evaluatePreStale, evaluateRun } from './oracles.mjs';
import { buildPreload, checkLookupPreload } from './preload.mjs';

export function buildMatrix({ stage, bundles, models }) {
  if (stage !== 'dev' && stage !== 'sealed') throw new Error('Unknown evaluation stage');
  const dev = stage === 'dev';
  if (models.length !== (dev ? 5 : 1) ||
      models.some(pin => typeof pin?.model !== 'string' || !pin.model.trim() || typeof pin?.provider !== 'string' || !pin.provider.trim()) ||
      new Set(models.map(pin => pin.model)).size !== models.length) throw new Error('Unexpected model/provider matrix');
  if (bundles.length !== (dev ? 2 : 5) || bundles.some(bundle => bundle.split !== stage) ||
      new Set(bundles.map(bundle => bundle.caseId)).size !== bundles.length ||
      (!dev && new Set(bundles.map(bundle => bundle.archetype)).size !== archetypes.length)) {
    throw new Error('Unexpected evaluation case matrix');
  }
  return bundles.flatMap(bundle => Array.from({ length: dev ? 1 : 2 }, (_, index) => {
    const arms = dev ? ARMS.slice(0, 2) : ARMS;
    // Rotate the sealed arm order between case/repeat blocks.
    const offset = dev ? bundles.indexOf(bundle) % arms.length : (bundles.indexOf(bundle) + index) % arms.length;
    return [...arms.slice(offset), ...arms.slice(0, offset)].flatMap(arm =>
      models.map(pin => ({ bundle, arm, repeat: index + 1, pin: structuredClone(pin) })));
  }).flat());
}

export function createMemoryCalendar(fixture) {
  let events = structuredClone(fixture.events);
  return {
    async events() { return structuredClone(events); },
    async create(_student, event) {
      if (events.some(item => item.id === event.id)) throw new Error('Calendar event already exists');
      events.push(structuredClone(event));
      return structuredClone(event);
    },
    async patch(_student, id, event) {
      if (!events.some(item => item.id === id)) throw new Error('Calendar event does not exist');
      events = events.map(item => item.id === id ? { ...item, ...structuredClone(event), id } : item);
    },
  };
}

async function withCaseRuntime(bundle, calendar, operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'study-eval-v2-'));
  const workspace = { allowedStudents: [bundle.student], requireStaged: true };
  try {
    return await withSyntheticRuntime(directory, async () => {
      await initializeScenario(calendar, bundle.student, { ...workspace, coldStart: true,
        workspaceSource: bundle.workspaceDir, calendarFixture: bundle.calendarFixture });
      return operation(directory, workspace);
    }, workspace);
  } finally {
    await disposeSyntheticRuntime(directory);
  }
}

function safeProposal(plan) {
  return plan && {
    courses: plan.sources.map(course => `${course.name} (${course.deadline})`),
    near: plan.near.map(event => `${event.summary}, ${event.start.dateTime} to ${event.end.dateTime}`),
    tentative: plan.future.map(event => `${event.summary}, ${event.start.dateTime} to ${event.end.dateTime}`),
    outlook: plan.outlook,
  };
}

async function staleProbe({ bundle, calendar, service, final, initial, events, writeAttempts }) {
  const preStale = evaluatePreStale(bundle, final, events, initial);
  const delta = bundle.oracle.stalePerturbation.event;
  if (events.some(event => event.id === delta.id)) await calendar.patch(bundle.student, delta.id, delta);
  else await calendar.create(bundle.student, delta);
  const perturbed = await calendar.events(bundle.student);
  const changed = digest(perturbed) !== digest(events) && digest(perturbed) !== final.plan.baseHash;
  let reason = 'unobserved';
  if (changed) {
    try {
      await service.approvePlan(final.plan.id, final.plan.near.length ? 'near' : 'future');
      reason = 'approved';
    } catch (error) {
      reason = /^STALE:/.test(error.message) ? 'STALE' : 'unexpected_error';
    }
  }
  return { preStale, reason, perturbationObserved: changed, providerAttempts: writeAttempts(),
    calendarPreserved: digest(await calendar.events(bundle.student)) === digest(perturbed), perturbed };
}

const observedSpend = usage => Number.isFinite(usage?.cost) && usage.cost >= 0 ? usage.cost : null;
const sumKnown = values => values.length && values.every(value => Number.isFinite(value) && value >= 0)
  ? values.reduce((total, value) => total + value, 0) : null;
const turnCounts = z.array(z.object({
  completions: z.number(), toolAttempts: z.number(), inputTokens: z.number(), generatedTokens: z.number(),
  spendUsd: z.number().nonnegative().nullable(),
}));
const runnerSnapshot = z.object({
  messages: z.array(z.strictObject({ type: z.enum(['user', 'assistant']), text: z.string() })),
  question: z.object({ requestId: z.string(), questions: z.array(z.object({
    id: z.string(), question: z.string(), options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
  })).min(1) }).nullable(),
  failure: z.strictObject({ kind: z.enum(['budget', 'quality', 'infrastructure', 'compatibility']), code: z.string() }).nullable(),
  turns: turnCounts,
  action: z.record(z.string(), z.unknown()).nullable(),
});

export async function runCase({
  cell, completeChat, gateway, runnerUrl, transport = 'loopback', fetchImpl = fetch,
  operator, operatorProviderPin, operatorCache, judgeModels = [], calendars = createMemoryCalendar,
  expectedPreload, joinMap = new Map(), onBlindedPacket,
}) {
  const { arm, bundle, repeat, pin } = cell;
  const record = { caseId: bundle.caseId, archetype: bundle.archetype, split: bundle.split, arm, repeat,
    model: pin.model, provider: pin.provider, elapsedMs: null, spendUsd: null, status: 'infrastructure_error', grades: {} };
  const started = performance.now();
  const roleSpend = [];
  const onUsage = usage => roleSpend.push(observedSpend(usage));
  let turns = [];
  let row;
  try {
    const calendar = await calendars(bundle.calendarFixture, cell);
    row = await withCaseRuntime(bundle, calendar, async (runtimeDirectory, workspace) => {
      let attempts = 0;
      const blockProviderWrite = async () => { attempts++; throw new Error('Calendar writes are outside this exercise'); };
      const serviceCalendar = { events: calendar.events.bind(calendar), create: blockProviderWrite,
        remove: blockProviderWrite, patch: blockProviderWrite };
      const disclosedSources = createDisclosedSources();
      const service = createTrustedStudyService({
        ...workspace, calendar: serviceCalendar, student: bundle.student, runtimeDirectory,
        clock: bundle.clock, coldStart: true, schemaProfile: 'eval-v2', disclosedSources,
      });
      const preload = await buildPreload({ bundle, agent: service.agent, disclosedSources });
      record.preloadSha256 = preload.sha256;
      if (expectedPreload && preload.sha256 !== expectedPreload) throw Object.assign(
        new Error('Calendar or preload differs between runs'), { code: 'preload_parity' });
      const lookupPreflight = checkLookupPreload(preload.packet, bundle.oracle.pdfLookupTarget);
      if (!lookupPreflight.clean) throw Object.assign(new Error('Lookup preload failed contamination checks'), { code: 'preload_contamination' });
      const initialEvents = await calendar.events(bundle.student);
      const roleB1 = operator ?? (gateway?.operatorToken && createOperatorB1({
        gateway, providerPin: operatorProviderPin, cache: operatorCache, transport, fetchImpl, onUsage,
        runIdentifiers: [pin.model],
      }));
      let runnerClean = true;
      const inspect = data => {
        if (!checkRunnerPayload({ bundle, ...data }).clean) {
          runnerClean = false;
          throw Object.assign(new Error('Runner content failed isolation checks'), { code: 'runner_contamination' });
        }
      };
      const bridge = createArmBridge(service, bundle.student, arm, { inspect, disclosedSources });
      // The evaluator also inspects the remote runner's actual outbound chat
      // requests before the gateway forwards them to the pinned provider.
      const removeInspector = gateway?.inspectRunnerRequests?.(payload => {
        inspect({ payload });
        if (pin.reasoningEffort !== undefined && payload.reasoning_effort !== pin.reasoningEffort) {
          throw new Error('Runner reasoning mode differs from the frozen configuration');
        }
      });
      let session;
      let failure;
      let lastAction;
      let messages = [];
      const exchanges = [];
      let firstDraft;
      let finalDraft;
      let lastPreview;
      let stale;
      let frictionDelivered = false;
      try {
        session = await startArmSession({ arm, bundle, bridge, preload, model: pin.model,
          completeChat, gateway, runnerUrl, transport, fetchImpl, schemaCompat: pin.schemaCompat, inspect });
        const operatorReplies = [bundle.initialRequest];
        let transition = () => session.prompt(bundle.initialRequest);
        let stage = 'initial';
        while (transition) {
          if (turns.length >= EVAL_LIMITS.maxUserTurns) {
            failure = { kind: 'budget', code: 'user_turn_limit' };
            break;
          }
          bridge.beginTurn();
          const response = runnerSnapshot.parse(await transition());
          ({ turns, failure, messages, action: lastAction } = response);
          inspect({ outputs: { messages, question: response.question, action: lastAction } });
          if (failure) break;
          if (response.question) {
            if (!roleB1) {
              failure = { kind: 'compatibility', code: 'operator_unavailable' };
              break;
            }
            const reply = await roleB1.reply({ bundle, visibleConversation: messages, question: response.question });
            inspect({ outputs: reply });
            operatorReplies.push(reply);
            transition = () => session.answer(response.question.requestId, [{ custom: reply }]);
            continue;
          }
          if (bridge.submission && lastAction?.action !== 'abstain_infeasible') {
            const { id, record: candidate, options, result: preview } = bridge.submission;
            if (!preview.ok && !lastAction?.shortfall) {
              failure = { kind: 'quality', code: 'unacknowledged_shortfall' };
              break;
            }
            await service.confirmPlanningContext(id, operatorReplies);
            const plan = await service.draftPlan(options);
            const draft = { record: candidate, options, plan, preview };
            if (stage === 'initial') firstDraft = draft;
            finalDraft = draft;
          } else if (stage === 'friction') {
            finalDraft = undefined;
          }
          lastPreview = bridge.previews.at(-1);
          exchanges.push({ stage, action: lastAction, proposal: safeProposal(finalDraft?.plan) });
          const responseCanCarryFriction = finalDraft || bundle.archetype === 'long_pdf_lookup' || bundle.archetype === 'infeasible_target';
          if (!frictionDelivered && responseCanCarryFriction) {
            frictionDelivered = true;
            stage = 'friction';
            const move = roleB1?.frictionMove ? roleB1.frictionMove(bundle) : bundle.frictionMove;
            operatorReplies.push(move);
            transition = () => session.prompt(move);
          } else {
            transition = null;
          }
        }
      } catch (error) {
        if (error.code === 'operator_leak' || error.code === 'runner_contamination') {
          runnerClean = false;
          failure = { kind: 'quality', code: error.code };
        } else if (error instanceof z.ZodError || error.code === 'runner_pin_mismatch') {
          failure = { kind: 'compatibility', code: 'invalid_session_payload' };
        } else {
          failure = { kind: 'infrastructure', code: 'session_or_operator_failed' };
        }
      } finally {
        try { await session?.close(); }
        finally { removeInspector?.(); }
      }

      if (!runnerClean && failure?.code !== 'operator_leak') {
        failure = { kind: 'quality', code: 'runner_contamination' };
      }
      const beforeApproval = await calendar.events(bundle.student);
      const providerAttempts = attempts;
      const calendarUnchanged = digest(initialEvents) === digest(beforeApproval);
      let capacity;
      if (!failure && bundle.oracle.infeasible && lastPreview) {
        const reference = bundle.oracle.infeasible.referenceRecord;
        const clock = bundle.clock;
        const preview = (input, options) => previewPlan(serviceCalendar, bundle.student, { ...options, record: input }, {
          ...workspace, today: clock.date, timezone: clock.timezone,
          timezoneOffset: timezoneOffsetForDate(clock.date, clock.timezone), disclosedSources, schemaProfile: 'eval-v2',
        });
        const independent = await preview(lastPreview.record, lastPreview.options);
        const trustedReference = reference && await preview(reference, { avoidDates: bundle.oracle.revision?.avoidDates ?? [] });
        capacity = { candidate: independent.capacityPerWeek, reference: trustedReference?.capacityPerWeek };
      }
      if (!failure && bundle.oracle.stalePerturbation && finalDraft && calendarUnchanged && !attempts) {
        stale = await staleProbe({ bundle, calendar, service, final: finalDraft, initial: firstDraft,
          events: beforeApproval, writeAttempts: () => attempts });
      }
      await service.drain();
      const evaluation = await evaluateRun({
        bundle, arm, turns, failure, messages, providerAttempts, calendarUnchanged, observedEvents: beforeApproval,
        initial: firstDraft, final: finalDraft, lastAction, records: bridge.planningRecords, reads: bridge.reads,
        disclosedSources, independentCapacity: capacity, stale, runnerClean, invalidCitation: bridge.invalidCitation,
      });
      const status = failure?.kind === 'infrastructure' ? 'infrastructure_error' :
        failure?.kind === 'compatibility' ? 'compatibility_error' : 'completed';
      if (status === 'completed' && runnerClean && (judgeModels.length || onBlindedPacket)) {
        const identifiers = { caseId: bundle.caseId, arm, model: pin.model, provider: pin.provider,
          engine: 'single-agent-http-v1', harness: 'eval-v2', repeat, student: bundle.student,
          studentName: bundle.calendarFixture.users[0].name };
        try {
          const packet = buildBlindedPacket({
            messages, proposalSummary: safeProposal(finalDraft?.plan), initialProposalSummary: safeProposal(firstDraft?.plan),
            identifiers, joinMap, privateMarkers: hiddenMarkers(bundle),
          });
          record.blindId = packet.blindId;
          await onBlindedPacket?.(packet);
          for (const model of judgeModels) {
            try {
              record.grades[model] = await createJudgeB2({ gateway, model, transport, fetchImpl, onUsage })(packet);
            } catch {
              record.grades[model] = null;
              roleSpend.push(null);
            }
          }
        } catch {
          record.gradingError = 'blinded_packet_unavailable';
        }
      }
      return { ...record, status, failure, ...evaluation, turns, providerAttempts, frictionDelivered,
        ...(capacity ? { capacity: capacity.candidate } : {}),
        ...(stale ? { stale: { ...stale, perturbed: undefined } } : {}), exchanges };
    });
  } catch (error) {
    row = { ...record, passed: false, eligible: false, outcome: null, turns,
      failure: { code: error.code ?? 'case_setup_or_cleanup_failed' } };
    if (['preload_contamination', 'runner_contamination'].includes(error.code)) {
      row.status = 'completed';
      row.gates = { contamination: { passed: false, findings: [error.code] } };
    }
  }
  return { ...row, elapsedMs: Math.round(performance.now() - started),
    spendUsd: sumKnown([...turns.map(turn => turn.spendUsd), ...roleSpend, ...(row.status === 'completed' ? [] : [null])]) };
}

export async function runMatrix({
  stage, bundles, models, repoPath = ROOT, peerRepoPath, gitLogText, openGateway,
  operatorCache = createOperatorCache(), judgeModels = JUDGE_MODELS, onBlindedPacket, ...runOptions
}) {
  const cells = buildMatrix({ stage, bundles, models });
  if (judgeModels.some(model => !JUDGE_MODELS.includes(model)) || new Set(judgeModels).size !== judgeModels.length) {
    throw new Error('Unexpected judge selection');
  }
  const preloads = [];
  const hashes = new Map();
  for (const bundle of bundles) {
    const calendar = createMemoryCalendar(bundle.calendarFixture);
    await withCaseRuntime(bundle, calendar, async (runtimeDirectory, workspace) => {
      const disclosedSources = createDisclosedSources();
      const service = createTrustedStudyService({ ...workspace, student: bundle.student, calendar,
        runtimeDirectory, clock: bundle.clock, coldStart: true, schemaProfile: 'eval-v2', disclosedSources });
      try {
        const preload = await buildPreload({ bundle, agent: service.agent, disclosedSources });
        preloads.push({ bundle, packet: preload.packet });
        hashes.set(bundle.caseId, preload.sha256);
      } finally {
        await service.drain();
      }
    });
  }
  const scan = await scanContamination({ bundles, repoPath, peerRepoPath, gitLogText, preloads });
  if (!scan.clean) return { scan, runs: [], joinMap: new Map() };
  const joinMap = new Map();
  const runs = [];
  for (const cell of cells) {
    let gateway;
    try {
      gateway = openGateway ? await openGateway(cell.pin) : runOptions.gateway;
      runs.push(await runCase({ ...runOptions, gateway, cell, operatorCache, joinMap, onBlindedPacket,
        expectedPreload: hashes.get(cell.bundle.caseId), judgeModels }));
    } catch {
      runs.push({ caseId: cell.bundle.caseId, archetype: cell.bundle.archetype, split: stage,
        arm: cell.arm, repeat: cell.repeat, model: cell.pin.model, provider: cell.pin.provider, status: 'infrastructure_error',
        passed: false, eligible: false, outcome: null, grades: {}, spendUsd: null,
        failure: { code: 'gateway_setup_failed' } });
    } finally {
      if (openGateway && gateway) await gateway.close();
    }
  }
  return { scan, runs, joinMap };
}
