import { Calendarpit, getRecoveryClaim } from '../core.mjs';
import { createClaimedCalendar } from '../foundation/claimed-calendar.mjs';
import { authorizeSyntheticCalendar } from '../foundation/synthetic-calendar-auth.mjs';
import { EVAL_CALENDAR_ORIGIN } from '../foundation/eval-transport.mjs';

export async function runComposeSweep({ cells, project, redirectUri, startCalendar, executeCell }) {
  const results = [];
  for (const [index, cell] of cells.entries()) {
    const run = await startCalendar({ project, fixture: cell.bundle.calendarFixture, redirectUri });
    try {
      results.push(await executeCell({ cell, index, run: { id: run.id, origin: run.origin, client: run.client } }));
    } finally {
      await run.close();
    }
  }
  return results;
}

export async function openClaimedEvalCalendar({ run, redirectUri, student, fetchImpl = fetch }) {
  if (run?.origin !== EVAL_CALENDAR_ORIGIN) throw new Error('Expected the isolated Compose Calendarpit');
  const transport = 'compose-eval';
  const allowedStudents = [student];
  const accessToken = await authorizeSyntheticCalendar({ run, student, redirectUri, allowedStudents, transport, fetchImpl });
  const calendar = createClaimedCalendar({ origin: run.origin, accessToken, getClaim: getRecoveryClaim,
    allowedStudents, transport, fetchImpl });
  // Only the evaluator's scripted stale probe uses this separate simulator control.
  const simulator = new Calendarpit(run.origin, { allowedStudents, transport, fetchImpl });
  return {
    calendar,
    perturbCalendar: (id, event, exists) => exists ? simulator.patch(id, event.id, event) : simulator.create(id, event),
  };
}
