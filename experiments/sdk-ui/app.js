const $=selector=>document.querySelector(selector);
let state;
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function local(iso){const parts=Object.fromEntries(formatter.formatToParts(new Date(iso)).map(x=>[x.type,x.value]));return {day:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute),time:`${parts.hour}:${parts.minute}`};}
function renderCalendar(){
  const calendar=$('#calendar');calendar.replaceChildren();
  const corner=document.createElement('div');corner.className='calendar-heading';calendar.append(corner);
  const labels=['Mon 2','Tue 3','Wed 4','Thu 5','Fri 6','Sat 7','Sun 8'];
  for(const label of labels){const el=document.createElement('div');el.className='calendar-heading';el.textContent=label;calendar.append(el);}
  const axis=document.createElement('div');axis.className='hours';
  for(let hour=1;hour<24;hour++){const el=document.createElement('span');el.className='hour';el.style.top=`${hour/24*100}%`;el.textContent=String(hour).padStart(2,'0')+':00';axis.append(el);}calendar.append(axis);
  const proposal=state.proposal?.payload?.sections?.near?.action?.event;
  for(let day=0;day<7;day++){
    const col=document.createElement('div');col.className='day';const date=`2026-11-${String(day+2).padStart(2,'0')}`;
    const items=[...state.events.filter(event=>event.status!=='cancelled').map(event=>({event,proposed:false})),...(proposal?[{event:proposal,proposed:true}]:[])].filter(({event})=>event.start?.dateTime&&event.end?.dateTime&&local(event.start.dateTime).day===date)
      .map(({event,proposed})=>({event,proposed,start:local(event.start.dateTime),end:local(event.end.dateTime)})).filter(x=>x.end.day===date&&x.end.minute>x.start.minute).sort((a,b)=>a.start.minute-b.start.minute||a.end.minute-b.end.minute);
    // Assign lanes per connected group so simultaneous events remain visible.
    const groups=[];for(const item of items){let group=groups.at(-1);if(!group||item.start.minute>=group.end){group={end:item.end.minute,items:[]};groups.push(group);}group.end=Math.max(group.end,item.end.minute);group.items.push(item);}
    for(const group of groups){const ends=[];for(const item of group.items){let lane=ends.findIndex(end=>end<=item.start.minute);if(lane<0)lane=ends.length;ends[lane]=item.end.minute;item.lane=lane;}for(const item of group.items){const el=document.createElement('button');el.type='button';el.className='event'+(item.proposed?' proposal':'');el.style.top=`${item.start.minute/1440*100}%`;el.style.height=`${(item.end.minute-item.start.minute)/1440*100}%`;el.style.left=`${item.lane/ends.length*100}%`;el.style.width=`${100/ends.length}%`;const kind=item.proposed?'Proposed':'Existing';el.title=`${kind} · ${item.event.summary||'Untitled'} · ${item.start.time}–${item.end.time}${item.event.status==='tentative'?' · tentative':''}${item.event.transparency==='transparent'?' · free':''}`;el.textContent=kind+' · '+(item.event.summary||'Untitled')+(item.event.status==='tentative'?' · tentative':'')+(item.event.transparency==='transparent'?' · free':'');const time=document.createElement('small');time.textContent=`${item.start.time}–${item.end.time}`;el.append(time);el.addEventListener('click',()=>{$('#status').textContent=el.title});col.append(el);}}
    calendar.append(col);
  }
}
function render(){renderCalendar();$('#calendar-state').textContent={
  'observed-before-review':'Calendar snapshot observed before review; later changes may not be shown.',
  'observed-after-attempt':'Calendar snapshot observed after the attempt; later changes may not be shown.',
  'previous-stale':'Current calendar unavailable. Showing the previous snapshot, which may be stale.',
  'shared-point-in-time':'Read-only shared calendar snapshot; later changes may not be shown.'
}[state.calendarStatus]||'Calendar snapshot status unavailable.';const proposal=state.proposal,event=proposal?.payload?.sections?.near?.action?.event;$('#details').hidden=!event;$('#approve').hidden=!!state.readOnly||!event;$('#reject').hidden=!!state.readOnly||!event;$('#draft').hidden=!!state.readOnly||!!event||['unknown','review','pending'].includes(state.outcome);$('#summary').textContent=event?event.summary:'Generate a proposal to see its details here.';if(event){const a=local(event.start.dateTime),b=local(event.end.dateTime);$('#time').textContent=`${a.day}, ${a.time}–${b.time}`;$('#event-status').textContent=event.status||'confirmed';$('#description').textContent=typeof event.description==='string'?event.description:'None';$('#source').textContent=Array.isArray(proposal.payload.sources)?proposal.payload.sources.join(', '):'Not provided';$('#assumption').textContent=Array.isArray(proposal.payload.assumptions)?proposal.payload.assumptions.join(' '):'Not provided';}if(state.readOnly&&state.stale)$('#status').textContent='Proposal is stale; obtain a fresh proposal before review.';else if(state.outcome)$('#status').textContent={completed:'Approved and added to the synthetic calendar.',rejected:'Rejected. No event was added.',failed:'Application failed; no event was added. Review the error before retrying.',unknown:'The result is uncertain. Stop and inspect the synthetic state.',review:'The result needs review. Stop and inspect the synthetic state.',pending:'Application pending. Stop and inspect the synthetic state.'}[state.outcome]||`State: ${state.outcome}`;}
async function request(path,body){const response=await fetch(path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed');return result;}
async function perform(fn){for(const el of document.querySelectorAll('.buttons button'))el.disabled=true;$('#status').textContent='Working…';try{state=await fn();$('#status').textContent='';render();}catch(error){try{state=await request('/api/state');render();}catch{}$('#status').textContent=error.message;}finally{for(const el of document.querySelectorAll('.buttons button'))el.disabled=false;}}
$('#draft').addEventListener('click',()=>perform(()=>request('/api/plan',{})));
for(const choice of ['approve','reject'])$(`#${choice}`).addEventListener('click',()=>perform(()=>request('/api/review',{proposalId:state.proposal.id,choice})));
perform(()=>request('/api/state'));
