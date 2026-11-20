// Translate recovery state into display decisions without guessing that an
// unavailable calendar is empty or that an in-flight action succeeded.
export function recoveryView(status) {
  const calendarAvailable=status?.calendar?.availability==='available'&&Array.isArray(status.events);
  const claim=status?.recovery||null,plan=status?.state?.plan;
  const sections={};
  for(const section of ['near','future']) {
    const current=plan?.status?.[section];
    const label=({pending:'approve',applying:'applyingStatus',partial:'partialStatus',applied:'applied'})[current]||'unknownStatus';
    const hasChanges=!!(plan?.[section]?.length||plan?.remove?.[section]?.length);
    sections[section]={label,canApprove:current==='pending'&&!claim&&calendarAvailable&&hasChanges};
  }
  const actions=(claim?.actions||[]).map(action=>({
    type:action.type||claim.kind,
    label:action.event?.summary||action.eventId||action.actionId||'—',
    status:claim.steps?.findLast(step=>step.actionId===action.actionId)?.status||'not-sent'
  }));
  const canReset=!claim&&['available','not_found'].includes(status?.calendar?.availability);
  return {calendarAvailable,canReset,claim,actions,sections};
}
