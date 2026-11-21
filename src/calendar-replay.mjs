/**
 * Convert the Calendarpit v0.9.7 management state into a portable data-only
 * replay fixture. A caller must register new local OAuth clients separately.
 * The result intentionally does not contain the input's OAuth/runtime state.
 *
 * This validates the supported shape, not every Calendarpit fixture rule; the
 * simulator remains the final validator when the fixture is loaded.
 */
const FIELDS = {
  users: ['id', 'name', 'email'],
  calendars: ['id', 'userId', 'summary', 'timeZone', 'primary'],
  events: ['id', 'calendarId', 'kind', 'summary', 'description', 'location', 'start', 'end', 'transparency', 'status', 'visibility', 'colorId', 'attendees', 'guestsCanModify', 'guestsCanInviteOthers', 'guestsCanSeeOtherGuests', 'reminders', 'organizer', 'creator', 'iCalUID', 'sequence', 'conferenceData', 'hangoutLink', 'recurrence', 'recurringEventId', 'originalStartTime', 'extendedProperties'],
};
const EVENT_OBSERVATIONS = ['etag', 'created', 'updated'];

function copyRows(snapshot, type) {
  if (!Array.isArray(snapshot[type])) throw new TypeError(`snapshot.${type} must be an array`);
  const allowed = new Set([...FIELDS[type], ...(type === 'events' ? EVENT_OBSERVATIONS : [])]);
  return snapshot[type].map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`${type}[${index}] must be an object`);
    const unknown = Object.keys(row).filter((key) => !allowed.has(key));
    if (unknown.length) throw new TypeError(`${type}[${index}] contains unsupported fields: ${unknown.join(', ')}`);
    if (typeof row.id !== 'string' || !row.id) throw new TypeError(`${type}[${index}] requires a stable id`);
    if (type === 'events' && (typeof row.calendarId !== 'string' || !row.calendarId)) {
      throw new TypeError(`events[${index}] requires a calendarId`);
    }
    return Object.fromEntries(FIELDS[type].filter((key) => row[key] !== undefined)
      .map((key) => [key, structuredClone(row[key])]));
  });
}

export function snapshotToReplayFixture(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('snapshot must be an object');
  const users = copyRows(snapshot, 'users');
  const calendars = copyRows(snapshot, 'calendars');
  const events = copyRows(snapshot, 'events');
  const observations = snapshot.events.map((event) => ({
    calendarId: event.calendarId,
    id: event.id,
    ...Object.fromEntries(EVENT_OBSERVATIONS.filter((key) => event[key] !== undefined)
      .map((key) => [key, structuredClone(event[key])])),
  }));
  return {
    schemaVersion: 1,
    fixture: { users, calendars, events, clients: [] },
    observations: { revision: snapshot.revision ?? null, events: observations },
    limitations: [
      'OAuth clients and connections must be recreated; prior approvals and ETags are not valid after replay.',
      'Calendar-list settings and deleted-calendar tombstones are absent from the state export.',
      'Fixture loading regenerates event timestamps and ETags and does not recreate invitation side effects.',
    ],
  };
}
