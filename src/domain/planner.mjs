import { createHash, randomUUID } from 'node:crypto';
import { calendarBoundaryMs as millis, intervalsOverlap as overlaps, isBusyCalendarEvent } from '../calendar-time.mjs';
import { DEFAULT_TIMEZONE_OFFSET, FIXED_TODAY, addDaysIso, localTime, validateClock } from './runtime.mjs';

const clone = value => structuredClone(value);

export function significant(event) {
  return {
    id: event.id,
    summary: event.summary,
    description: event.description || '',
    start: event.start,
    end: event.end,
    location: event.location || '',
    attendees: event.attendees || [],
    status: event.status || 'confirmed',
    transparency: event.transparency || 'opaque',
    extendedProperties: event.extendedProperties || {},
  };
}

export function snapshot(events) {
  return events.map(significant).sort((a, b) => a.id.localeCompare(b.id));
}

export function digest(events) {
  return createHash('sha256').update(JSON.stringify(snapshot(events))).digest('hex');
}

export function diffSnapshots(before, after) {
  const leftMap = new Map(snapshot(before).map(event => [event.id, event]));
  const rightMap = new Map(snapshot(after).map(event => [event.id, event]));
  const result = [];
  for (const id of new Set([...leftMap.keys(), ...rightMap.keys()])) {
    const left = leftMap.get(id);
    const right = rightMap.get(id);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      result.push({ id, before: left || null, after: right || null });
    }
  }
  return result;
}

export function makePlan(
  student,
  events,
  {
    weeks = 4,
    hours,
    protectedIds = [],
    avoidDates = [],
    preferredPeriod,
    focusCourse,
    allocation,
    today: clockDate = FIXED_TODAY,
    timezoneOffset = DEFAULT_TIMEZONE_OFFSET,
  } = {},
) {
  validateClock(clockDate, timezoneOffset);
  const target = Number(hours ?? student.targetHours);
  if (!Number.isInteger(target) || target < 0 || target > 20) throw new Error('Hours must be a whole number between 0 and 20');
  const requested = Number(weeks);
  if (!Number.isInteger(requested) || requested < 1 || requested > 16) throw new Error('Weeks must be between 1 and 16');
  if (!Array.isArray(avoidDates) || avoidDates.length > 112 || avoidDates.some(d => typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    throw new Error('Avoid dates must be ISO dates');
  }
  if (preferredPeriod && !['morning', 'afternoon', 'evening'].includes(preferredPeriod)) {
    throw new Error('Unknown preferred period');
  }
  if (allocation !== undefined && allocation !== 'course-coverage') throw new Error('Unknown allocation strategy');
  if (allocation && focusCourse) throw new Error('Choose course coverage or a single-course focus for this proposal');

  const focus = focusCourse
    ? student.courses.find(c => c.name.toLocaleLowerCase() === String(focusCourse).toLocaleLowerCase())
    : null;
  if (focusCourse && !focus) throw new Error('Focus course is not in the student course index');

  const windows = student.studyWindows || [];
  const maxDaily = student.maxDailyStudyHours ?? 2;
  const breakMinutes = student.studyBreakMinutes ?? 15;
  const parseTime = value => {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Invalid study window time');
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  };
  if (
    !Array.isArray(windows) ||
    windows.length > 30 ||
    !Number.isInteger(maxDaily) ||
    maxDaily < 1 ||
    maxDaily > 12 ||
    !Number.isInteger(breakMinutes) ||
    breakMinutes < 0 ||
    breakMinutes > 120
  ) {
    throw new Error('Invalid study availability');
  }
  for (const window of windows) {
    if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6 || parseTime(window.end) <= parseTime(window.start)) {
      throw new Error('Invalid study window');
    }
  }

  const start = new Date(`${clockDate}T00:00:00Z`);
  const today = Date.parse(`${clockDate}T00:00:00${timezoneOffset}`);
  const nextWeekStart = Date.parse(`${addDaysIso(clockDate, 7)}T00:00:00${timezoneOffset}`);
  const upcomingDeadlines = student.courses.map(c => Date.parse(c.deadline)).filter(deadline => deadline > today);
  const deadline = upcomingDeadlines.length ? Math.min(...upcomingDeadlines) : today;
  const maxWeeks = Math.max(1, Math.ceil((deadline - today) / (7 * 86_400_000)));
  const scopedEnd = student.availabilityThrough
    ? Date.parse(`${student.availabilityThrough}T00:00:00${timezoneOffset}`) + 86_400_000
    : Infinity;
  const count = Math.min(requested, maxWeeks, 16, Math.ceil((scopedEnd - today) / (7 * 86_400_000)));
  const horizonEnd = Math.min(today + count * 7 * 86_400_000, scopedEnd);

  const replaceable = events.filter(
    event =>
      event.extendedProperties?.private?.studyDemo === 'true' &&
      event.extendedProperties?.private?.student === student.student &&
      !protectedIds.includes(event.id) &&
      millis(event, 'start') >= today &&
      millis(event, 'start') < horizonEnd,
  );
  const replaceIds = new Set(replaceable.map(event => event.id));
  const busy = events.filter(event => isBusyCalendarEvent(event) && !replaceIds.has(event.id)).map(clone);
  const blocks = [];
  const outlook = [];
  const coveredCourses = new Set();

  for (let w = 0; w < count; w++) {
    let placed = 0;
    const daily = new Map();
    const weekBlocks = [];
    const candidates = [];
    const sorted = [...student.courses].sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getTime() + (w * 7 + d) * 86_400_000);
      const dayKey = day.toISOString().slice(0, 10);
      if (avoidDates.includes(dayKey) || (student.availabilityThrough && dayKey > student.availabilityThrough)) continue;
      for (const window of windows.filter(item => item.weekday === day.getUTCDay())) {
        for (let minute = parseTime(window.start); minute + 60 <= parseTime(window.end); minute += 15) {
          const dt = new Date(day.getTime() + minute * 60_000);
          const end = new Date(dt.getTime() + 3_600_000);
          const period = minute < 720 ? 'morning' : minute < 1080 ? 'afternoon' : 'evening';
          candidates.push({
            d,
            dayKey,
            dt,
            period,
            start: { dateTime: localTime(dt, timezoneOffset), timeZone: student.timezone },
            end: { dateTime: localTime(end, timezoneOffset), timeZone: student.timezone },
          });
        }
      }
    }
    while (placed < target && candidates.length) {
      candidates.sort(
        (a, b) =>
          (daily.get(a.dayKey) || 0) - (daily.get(b.dayKey) || 0) ||
          (preferredPeriod ? Number(a.period !== preferredPeriod) - Number(b.period !== preferredPeriod) : 0) ||
          a.dt - b.dt,
      );
      const candidate = candidates.shift();
      if ((daily.get(candidate.dayKey) || 0) >= maxDaily || busy.some(event => overlaps(event, candidate))) continue;
      const cStart = millis(candidate, 'start');
      const cEnd = millis(candidate, 'end');
      const gap = breakMinutes * 60_000;
      if (weekBlocks.some(event => cStart < millis(event, 'end') + gap && millis(event, 'start') < cEnd + gap)) continue;
      // Choose among courses that can actually use this block. An expired
      // course must not consume a candidate that another course can use.
      const eligible = sorted.filter(course => cEnd <= Date.parse(course.deadline));
      if (!eligible.length) continue;
      const daysToDeadline = (Date.parse(eligible[0].deadline) - cStart) / 86_400_000;
      const focused = focus && eligible.includes(focus) ? focus : null;
      const other = focused ? eligible.find(course => course !== focused) : null;
      const uncovered = allocation === 'course-coverage' ? eligible.find(course => !coveredCourses.has(course.name)) : undefined;
      const normalCourse = focused
        ? placed % 3 === 2 && other
          ? other
          : focused
        : daysToDeadline <= 14 && placed % 3 !== 2
          ? eligible[0]
          : eligible[(w + candidate.d) % eligible.length];
      const course = uncovered || normalCourse;
      coveredCourses.add(course.name);
      const block = {
        id: randomUUID().replaceAll('-', ''),
        summary: `Study: ${course.name}`,
        start: candidate.start,
        end: candidate.end,
        status: w === 0 ? 'confirmed' : 'tentative',
        description: `Study planning demo. ${w === 0 ? 'Near-term study block.' : 'Tentative; review at the next checkpoint.'} Source: ${course.source}`,
        extendedProperties: { private: { studyDemo: 'true', student: student.student, course: course.name } },
      };
      blocks.push(block);
      weekBlocks.push(block);
      busy.push(block);
      daily.set(candidate.dayKey, (daily.get(candidate.dayKey) || 0) + 1);
      placed++;
    }
    outlook.push({ week: w + 1, targetHours: target, scheduledHours: placed, shortfall: Math.max(0, target - placed) });
  }

  return {
    id: randomUUID(),
    student: student.student,
    createdAt: new Date().toISOString(),
    fixedToday: clockDate,
    sources: student.courses,
    assumptions: [
      'Study blocks are suggestions; ask before writing.',
      'Hours are goals, not evidence of actual study.',
      windows.length
        ? 'Study windows are stated possibilities; confirm they still suit the student.'
        : 'No study availability supplied; empty calendar time is not assumed available.',
      ...(student.availabilityThrough ? [`Confirmed availability applies through ${student.availabilityThrough}.`] : []),
      ...(focus ? [`Course focus: ${focus.name}; other courses may still receive blocks.`] : []),
    ],
    ...(allocation ? { allocation } : {}),
    outlook,
    near: blocks.filter(block => block.status === 'confirmed'),
    future: blocks.filter(block => block.status === 'tentative'),
    remove: {
      near: replaceable.filter(event => millis(event, 'start') < nextWeekStart).map(significant),
      future: replaceable.filter(event => millis(event, 'start') >= nextWeekStart).map(significant),
    },
    baseHash: digest(events),
    status: { near: 'pending', future: 'pending' },
  };
}
