function localDate(value, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const dayMs = 86_400_000;
const duration = block => (Date.parse(block.end) - Date.parse(block.start)) / 60_000;
const overlaps = (left, right) => Date.parse(left.start) < Date.parse(right.end) && Date.parse(right.start) < Date.parse(left.end);

export function proposalAdditions(proposal) {
  return [...proposal.sections.near, ...proposal.sections.future].filter(action => action.kind === 'add');
}

export function validateSchedule(proposal, events, manifest) {
  const blocks = proposalAdditions(proposal);
  const { date, timezone } = manifest.clock;
  const deadlines = new Map(proposal.sources.map(source => [source.course, Date.parse(source.deadline)]));
  const busy = events.filter(event => event.status !== 'cancelled' && event.transparency !== 'transparent').map(event => ({
    start: event.start.dateTime || event.start.date + 'T00:00:00-03:00',
    end: event.end.dateTime || event.end.date + 'T00:00:00-03:00',
  }));
  const findings = [];
  if (blocks.length === 0) findings.push('No study blocks in the proposal');
  for (const [index, block] of blocks.entries()) {
    const day = localDate(block.start, timezone);
    if (manifest.expect.avoidDates.includes(day)) findings.push(`Study block falls on excluded date ${day}`);
    if (day < date || duration(block) <= 0) findings.push(`Invalid study interval ${block.eventId}`);
    if (!deadlines.has(block.course) || Date.parse(block.end) > deadlines.get(block.course)) findings.push(`Study block exceeds its deadline ${block.eventId}`);
    if (busy.some(event => overlaps(event, block)) || blocks.slice(0, index).some(other => overlaps(other, block))) {
      findings.push(`Study block overlaps a commitment ${block.eventId}`);
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
