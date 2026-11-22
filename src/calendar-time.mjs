// Calendarpit's synthetic all-day boundaries are midnight in São Paulo.
// Timed boundaries keep the offsets supplied by the simulator.
export function calendarBoundaryMs(event, side) {
  const boundary = event[side];
  return Date.parse(boundary?.dateTime || (boundary?.date && boundary.date + 'T00:00:00-03:00'));
}

export function intervalsOverlap(a, b) {
  return calendarBoundaryMs(a, 'start') < calendarBoundaryMs(b, 'end') &&
    calendarBoundaryMs(b, 'start') < calendarBoundaryMs(a, 'end');
}

export function isBusyCalendarEvent(event) {
  return event.status !== 'cancelled' && event.transparency !== 'transparent';
}
