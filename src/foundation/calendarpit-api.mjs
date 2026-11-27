import { EVAL_CALENDAR_ORIGIN, syntheticHttpUrl } from './eval-transport.mjs';

// Google Calendar-compatible synthetic provider client. No administrative endpoints.
export class CalendarApiError extends Error {
  constructor(status) {
    super(`Synthetic calendar API request failed (HTTP ${status})`);
    this.name = 'CalendarApiError';
    this.status = status;
  }
}

const requiredString = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
};
const id = (value, name) => {
  requiredString(value, name);
  if (!/^[a-zA-Z0-9@._-]{1,128}$/.test(value) || value === '.' || value === '..') throw new Error(`Invalid ${name}`);
  return encodeURIComponent(value);
};
const listParameters = new Set(['timeMin', 'timeMax', 'singleEvents', 'showDeleted', 'orderBy', 'maxResults', 'pageToken', 'syncToken', 'timeZone']);

/** Synthetic Calendarpit only. This adapter is not connected to the prototype.
 * The trusted caller supplies an access token obtained through synthetic OAuth and a verifier
 * that checks an approval against the complete write action. No secrets are returned or logged.
 */
export class CalendarpitApi {
  #origin;
  #token;
  #fetch;
  #authorizeWrite;

  constructor({ origin, accessToken, authorizeWrite, fetchImpl = fetch, transport = 'loopback' }) {
    this.#origin = syntheticHttpUrl(origin, {
      transport, peer: EVAL_CALENDAR_ORIGIN, routes: ['/'], requirePort: true, message: 'Synthetic localhost or explicit Compose origin required',
    }).origin;
    this.#token = requiredString(accessToken, 'Synthetic access token');
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
    if (authorizeWrite !== undefined && typeof authorizeWrite !== 'function') throw new Error('Approval verifier must be a function');
    this.#fetch = fetchImpl;
    this.#authorizeWrite = authorizeWrite;
  }

  async #request(method, endpoint, { body, etag, query } = {}) {
    const url = new URL(`/calendar/v3${endpoint}`, this.#origin);
    if (query) for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const headers = { authorization: `Bearer ${this.#token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (etag !== undefined) headers['if-match'] = etag;
    const response = await this.#fetch(url.href, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new CalendarApiError(response.status);
    return response.status === 204 ? undefined : response.json();
  }

  async #approve(action, approval) {
    if (!this.#authorizeWrite || !approval || typeof approval !== 'object') throw new Error('Explicit approval and a trusted verifier are required');
    if (await this.#authorizeWrite(structuredClone(action), structuredClone(approval)) !== true) throw new Error('Write approval rejected');
  }

  async listEvents(calendarId, options = {}) {
    for (const key of Object.keys(options)) if (!listParameters.has(key)) throw new Error(`Unsupported event list option: ${key}`);
    const page = await this.#request('GET', `/calendars/${id(calendarId, 'Calendar ID')}/events`, { query: options });
    return page; // nextPageToken must be followed by the caller; never silently omit it.
  }
  async getEvent(calendarId, eventId) {
    return this.#request('GET', `/calendars/${id(calendarId, 'Calendar ID')}/events/${id(eventId, 'Event ID')}`);
  }
  async freeBusy({ timeMin, timeMax, calendarIds }) {
    requiredString(timeMin, 'timeMin'); requiredString(timeMax, 'timeMax');
    if (!Array.isArray(calendarIds) || !calendarIds.length || calendarIds.length > 50) throw new Error('One to 50 calendar IDs are required');
    const items = calendarIds.map(value => ({ id: requiredString(value, 'Calendar ID') }));
    return this.#request('POST', '/freeBusy', { body: { timeMin, timeMax, items } });
  }
  async createApprovedEvent({ calendarId, event, approval }) {
    id(calendarId, 'Calendar ID');
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Event is required');
    id(event.id, 'Stable event ID');
    const action = { type: 'create', calendarId, event: structuredClone(event) };
    await this.#approve(action, approval);
    return this.#request('POST', `/calendars/${id(calendarId, 'Calendar ID')}/events`, { body: action.event });
  }
  async patchApprovedEvent({ calendarId, eventId, etag, changes, approval }) {
    id(calendarId, 'Calendar ID'); id(eventId, 'Event ID'); requiredString(etag, 'Observed ETag');
    if (etag.trim() === '*') throw new Error('A specific observed ETag is required');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Event changes are required');
    const action = { type: 'patch', calendarId, eventId, etag, changes: structuredClone(changes) };
    await this.#approve(action, approval);
    return this.#request('PATCH', `/calendars/${id(calendarId, 'Calendar ID')}/events/${id(eventId, 'Event ID')}`, { body: action.changes, etag });
  }
  async deleteApprovedEvent({ calendarId, eventId, etag, approval }) {
    id(calendarId, 'Calendar ID'); id(eventId, 'Event ID'); requiredString(etag, 'Observed ETag');
    if (etag.trim() === '*') throw new Error('A specific observed ETag is required');
    const action = { type: 'delete', calendarId, eventId, etag };
    await this.#approve(action, approval);
    return this.#request('DELETE', `/calendars/${id(calendarId, 'Calendar ID')}/events/${id(eventId, 'Event ID')}`, { etag });
  }
}
