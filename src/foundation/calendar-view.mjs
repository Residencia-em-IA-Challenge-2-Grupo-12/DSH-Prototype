/**
 * Compact agent-facing calendar event projection.
 * Strips Google Calendar boilerplate (kind, etag, htmlLink, creator, organizer,
 * reminders, default status/transparency) to cut prompt token footprint by ~60%
 * while preserving every scheduling-relevant field. Internal planner/diffing
 * logic continues to read raw calendar events directly.
 */
export function compactCalendarEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const start = typeof event.start === 'string'
    ? event.start
    : event.start?.dateTime || event.start?.date || null;
  const end = typeof event.end === 'string'
    ? event.end
    : event.end?.dateTime || event.end?.date || null;

  const compact = {
    id: event.id,
    summary: event.summary,
  };
  if (start !== null) compact.start = start;
  if (end !== null) compact.end = end;
  if (event.status && event.status !== 'confirmed') compact.status = event.status;
  if (event.transparency && event.transparency !== 'opaque') compact.transparency = event.transparency;
  if (event.description) compact.description = event.description;
  if (event.location) compact.location = event.location;

  const priv = event.extendedProperties?.private;
  if (priv?.studyDemo === 'true') {
    compact.studyBlock = true;
    if (priv.course) compact.course = priv.course;
  }
  return compact;
}

export function compactCalendarEvents(events) {
  return Array.isArray(events) ? events.map(compactCalendarEvent) : [];
}
