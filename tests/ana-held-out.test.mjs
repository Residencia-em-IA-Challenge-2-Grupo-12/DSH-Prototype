import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { applyApproved, initializeScenario, ROOT, runtimeDir } from '../src/core.mjs';
import { createTrustedStudyService } from '../src/foundation/trusted-study-service.mjs';

test('held-out Ana uses the published source and preserves the other Wednesday after a one-date correction', async () => {
  const load = async filename => JSON.parse(await readFile(path.join(ROOT, 'fixtures', filename)));
  const { events } = await load('calendars/ana.json');
  const manifest = await load('paired-replay/ana-held-out/case.json');
  const calendar = { events: async () => structuredClone(events) };
  await initializeScenario(calendar, 'ana', { coldStart: manifest.id });
  const service = createTrustedStudyService({ student: 'ana', calendar, runtimeDirectory: runtimeDir(), coldStart: true });
  const tool = (name, input = {}) => service.agent.call(name, { ...input, student: 'ana' });

  assert.deepEqual((await tool('list_synthetic_files')).map(entry => entry.name).sort(), ['course', 'lms']);
  await assert.rejects(() => tool('read_synthetic_file', { path: 'case.json' }), /ENOENT/);
  await assert.rejects(() => tool('read_synthetic_file', { path: 'preferences.json' }), /ENOENT/);
  const outline = await tool('read_synthetic_file', { path: 'course/module-outline.md' });
  assert.match(outline, /24 November/);
  const source = JSON.parse(await tool('read_synthetic_file', { path: manifest.expect.deadline.source }));
  assert.equal(source.assessment.release.status, 'published');
  assert.equal(source.assessment.changeLog[0].status, 'superseded');
  assert.equal(Date.parse(source.assessment.release.dueAt), Date.parse(manifest.expect.deadline.at));

  const inputs = await tool('propose_planning_context', { record: {
    courses: [{ name: manifest.expect.deadline.course, date: '2026-12-01', time: '17:30', citation: {
      path: manifest.expect.deadline.source, quote: '"dueAt": "2026-12-01T20:30:00Z"',
    }, resolution: 'Use published revision 2. Revision 1 and the October outline are superseded.' }],
    studyWindows: [3, 4, 5].map(weekday => ({ weekday, start: '14:00', end: '16:15' })),
    targetHours: 4, maxDailyStudyHours: 2, studyBreakMinutes: 15, through: '2026-11-15',
    assumption: 'Four hours per week, weekdays only, for this exercise.',
  } });
  await service.confirmPlanningContext(inputs.id, manifest.operator.answers.slice(0, 2).map(answer => answer.text));
  const original = await tool('draft_study_plan', { weeks: 2 });
  assert.ok(original.near.some(event => event.start.dateTime.startsWith('2026-11-04')));
  const revised = await tool('draft_study_plan', { weeks: 2, avoidDates: manifest.expect.avoidDates });
  assert.equal(revised.sources[0].deadline, manifest.expect.deadline.at);
  assert.notEqual(revised.id, original.id);
  assert.deepEqual(revised.outlook.map(week => week.scheduledHours), [4, 4]);
  assert.ok(revised.near.every(event => !event.start.dateTime.startsWith('2026-11-04')));
  assert.ok(revised.future.some(event => event.start.dateTime.startsWith('2026-11-11')));
  await assert.rejects(() => applyApproved(calendar, 'ana', original.id, 'near'), /not pending/);
  assert.deepEqual(await calendar.events(), events);
});
