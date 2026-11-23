function localDate(value, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTime(value, timezone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit',
    fractionalSecondDigits: 3, hourCycle: 'h23' }).format(new Date(value));
}

const dayMs = 86_400_000;
const duration = block => (Date.parse(block.end) - Date.parse(block.start)) / 60_000;
const overlaps = (left, right) => Date.parse(left.start) < Date.parse(right.end) && Date.parse(right.start) < Date.parse(left.end);

export function proposalAdditions(proposal) {
  return [...proposal.sections.near, ...proposal.sections.future].filter(action => action.kind === 'add');
}

export function validateSchedule(proposal, events, manifest, reviewed, { allowShortfall = false } = {}) {
  const blocks = proposalAdditions(proposal);
  const { date, timezone } = manifest.clock;
  const deadlines = new Map(proposal.sources.map(source => [source.course, Date.parse(source.deadline)]));
  const busy = events.filter(event => event.status !== 'cancelled' && event.transparency !== 'transparent').map(event => ({
    start: event.start.dateTime || event.start.date + 'T00:00:00-03:00',
    end: event.end.dateTime || event.end.date + 'T00:00:00-03:00',
  }));
  const findings = [], byDay = new Map(), byWeek = new Map();
  if (blocks.length === 0 && !allowShortfall) findings.push('No study blocks in the proposal');
  for (const [index, block] of blocks.entries()) {
    const start = Date.parse(block.start), end = Date.parse(block.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      findings.push(`Invalid study interval ${block.eventId}`);
      continue;
    }
    const day = localDate(block.start, timezone);
    if (manifest.expect.avoidDates.includes(day)) findings.push(`Study block falls on excluded date ${day}`);
    if (day < date) findings.push(`Study interval precedes the simulation clock ${block.eventId}`);
    if (!Number.isFinite(deadlines.get(block.course)) || end > deadlines.get(block.course)) findings.push(`Study block exceeds or lacks its deadline ${block.eventId}`);
    if (busy.some(event => overlaps(event, block)) || blocks.slice(0, index).some(other => overlaps(other, block))) {
      findings.push(`Study block overlaps a commitment ${block.eventId}`);
    }
    if (reviewed) {
      const weekday = new Date(day + 'T00:00:00Z').getUTCDay();
      const from = localTime(start, timezone), to = localTime(end, timezone);
      if (day > reviewed.through || localDate(end, timezone) !== day ||
          !reviewed.studyWindows.some(window => window.weekday === weekday && `${window.start}:00.000` <= from && `${window.end}:00.000` >= to)) {
        findings.push(`Study block falls outside reviewed availability ${block.eventId}`);
      }
      const week = Math.floor((Date.parse(day) - Date.parse(date)) / (7 * dayMs));
      if ((week === 0) !== proposal.sections.near.some(action => action.eventId === block.eventId)) {
        findings.push(`Study block belongs to a different approval section ${block.eventId}`);
      }
      const daily = byDay.get(day) || [];
      daily.push({ start, end });
      byDay.set(day, daily);
      byWeek.set(week, (byWeek.get(week) || 0) + duration(block));
    }
  }
  if (reviewed) {
    for (const [day, intervals] of byDay) {
      intervals.sort((left, right) => left.start - right.start);
      if (intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0) > reviewed.maxDailyStudyHours * 3_600_000) {
        findings.push(`Study time exceeds the reviewed daily cap on ${day}`);
      }
      if (intervals.some((interval, index) => index && interval.start - intervals[index - 1].end < reviewed.studyBreakMinutes * 60_000)) {
        findings.push(`Study blocks leave too little break time on ${day}`);
      }
    }
    const weeks = Math.ceil((Date.parse(reviewed.through) - Date.parse(date) + dayMs) / (7 * dayMs));
    for (let week = 0; week < weeks; week++) {
      const scheduled = byWeek.get(week) || 0;
      const target = reviewed.targetHours * 60;
      if (allowShortfall ? scheduled > target : scheduled !== target) findings.push(`Study time differs from the reviewed target in week ${week + 1}`);
    }
  }
  return findings;
}

// A reviewer extracts explicit duration claims from narration. The checker uses
// actual allocations, including the whole future section, without calling a model.
export function compareScheduleClaims(proposal, clock, claims) {
  const daily = new Map();
  for (const block of proposalAdditions(proposal)) {
    const date = localDate(block.start, clock.timezone);
    daily.set(date, (daily.get(date) || 0) + duration(block));
  }
  return claims.map(claim => {
    const actualMinutes = claim.date !== undefined ? daily.get(claim.date) || 0 :
      [...daily.entries()].filter(([date]) => Math.floor((Date.parse(date) - Date.parse(clock.date)) / (7 * dayMs)) === claim.week - 1)
        .reduce((sum, [, minutes]) => sum + minutes, 0);
    return { ...claim, actualMinutes, matches: actualMinutes === claim.minutes };
  });
}
