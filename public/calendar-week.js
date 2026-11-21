const DAY=86400000;
const addDays=(key,n)=>new Date(Date.parse(key+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
function localTime(value,zone){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,minutes:Number(p.hour)*60+Number(p.minute)};
}

// Shared display model: observed events and pending proposal overlays remain
// distinct. This renderer does not plan, approve or mutate calendar data.
export function calendarWeekModel({events=[],plan,options=[],weekOffset=0,timeZone='America/Sao_Paulo',fixedDate='2026-11-02'}={}){
  const start=addDays(fixedDate,weekOffset*7),entries=[],removed=new Set();
  for(const section of ['near','future'])if(plan?.status?.[section]==='pending')for(const e of plan.remove?.[section]||[])removed.add(e.id);
  for(const event of events||[])if(event.status!=='cancelled')entries.push({event,kind:removed.has(event.id)?'removal':'existing'});
  const observed=new Set(entries.map(x=>x.event.id));
  for(const option of options)for(const [index,window] of option.windows.entries()){
    entries.push({kind:window.conflicts?.length?'conflict':'candidate',event:{
      id:`preview-${option.label}-${index}`,summary:option.label,start:{dateTime:window.startDateTime},end:{dateTime:window.endDateTime},
    }});
  }
  for(const section of ['near','future'])if(plan?.status?.[section]==='pending')for(const event of plan[section]||[])if(!observed.has(event.id))entries.push({event,kind:'proposed',section});
  return {start,end:addDays(start,6),days:Array.from({length:7},(_,offset)=>{
    const date=addDays(start,offset),blocks=[];
    for(const item of entries){
      const {event}=item;
      if(event.start?.date){
        const end=event.end?.date||addDays(event.start.date,1);
        if(event.start.date<=date&&date<end)blocks.push({...item,allDay:true,startMinute:0,endMinute:1440});
      }else if(event.start?.dateTime&&event.end?.dateTime){
        const a=localTime(event.start.dateTime,timeZone),b=localTime(event.end.dateTime,timeZone);
        if(a.date>date||b.date<date||b.date===date&&b.minutes===0)continue;
        const from=a.date<date?0:a.minutes,to=b.date>date?1440:b.minutes;
        if(to>from)blocks.push({...item,allDay:false,startMinute:from,endMinute:to});
      }
    }
    return {date,blocks:blocks.sort((a,b)=>a.startMinute-b.startMinute||b.endMinute-a.endMinute)};
  })};
}

const text={en:{previous:'Previous week',next:'Next week',calendar:'Weekly calendar preview',existing:'On calendar',candidate:'Availability option',conflict:'Option conflicts',proposed:'Proposed addition',removal:'Proposed removal',allDay:'All day',empty:'No events this week',optionNote:'Availability options and proposed changes are previews. Calendar approval is separate.',note:'Outlined blocks are proposals. Chat does not approve changes; use the separate review controls.',time:'Time',details:'Activity details',future:'Future proposal',near:'Coming-week proposal'},pt:{previous:'Semana anterior',next:'Próxima semana',calendar:'Prévia semanal do calendário',existing:'No calendário',candidate:'Opção de horário',conflict:'Opção com conflito',proposed:'Adição proposta',removal:'Remoção proposta',allDay:'Dia todo',empty:'Sem eventos nesta semana',optionNote:'As opções de horário e as mudanças propostas são prévias. A aprovação do calendário é separada.',note:'Blocos contornados são propostas. A conversa não aprova alterações; use os controles de revisão separados.',time:'Hora',details:'Detalhes da atividade',future:'Proposta futura',near:'Proposta da próxima semana'}};
const clock=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
export function mountCalendarWeek(root){
  const document=root.ownerDocument;
  const el=(tag,content,cls)=>{const n=document.createElement(tag);if(content!==undefined)n.textContent=content;if(cls)n.className=cls;return n;};
  let offset=0,input={},key='';
  const toolbar=el('div',undefined,'calendar-toolbar'),previous=el('button'),label=el('strong'),next=el('button');
  previous.type=next.type='button';toolbar.append(previous,label,next);
  const legend=el('div',undefined,'calendar-legend'),scroll=el('div',undefined,'calendar-scroll'),details=el('p',undefined,'calendar-selection'),note=el('p',undefined,'calendar-note');
  details.setAttribute('role','status');root.replaceChildren(toolbar,legend,scroll,details,note);
  previous.onclick=()=>{offset--;render();};next.onclick=()=>{offset++;render();};
  function render(){
    const locale=input.language==='pt'?'pt-BR':'en',t=text[input.language==='pt'?'pt':'en'];
    const model=calendarWeekModel({...input,weekOffset:offset}),format=new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',timeZone:'UTC'});
    previous.textContent='← '+t.previous;next.textContent=t.next+' →';label.textContent=`${format.format(new Date(model.start+'T12:00Z'))} – ${format.format(new Date(model.end+'T12:00Z'))}`;
    legend.replaceChildren(...['existing','proposed','removal',...(input.options?.length?['candidate','conflict']:[])].map(kind=>el('span',t[kind],kind)));note.textContent=input.options?.length?t.optionNote:t.note;
    const grid=el('div',undefined,'calendar-grid'),header=el('div',undefined,'calendar-day-heading');header.textContent=t.time;grid.append(header);
    const weekday=new Intl.DateTimeFormat(locale,{weekday:'short',day:'numeric',timeZone:'UTC'});
    for(const day of model.days)grid.append(el('div',weekday.format(new Date(day.date+'T12:00Z')),'calendar-day-heading'));
    grid.append(el('div',t.allDay,'calendar-all-day-label'));
    for(const day of model.days){const cell=el('div',undefined,'calendar-all-day');for(const b of day.blocks.filter(b=>b.allDay))cell.append(el('span',b.event.summary,'calendar-all-day-event '+b.kind));grid.append(cell);}
    const hours=el('div',undefined,'calendar-hours');for(let hour=0;hour<24;hour++){const n=el('span',clock(hour*60));n.style.top=`${hour*32}px`;hours.append(n);}grid.append(hours);
    for(const day of model.days){
      const column=el('div',undefined,'calendar-day');
      const blocks=day.blocks.filter(b=>!b.allDay),groups=[];
      for(const block of blocks){let group=groups.at(-1);if(!group||block.startMinute>=group.end){group={end:block.endMinute,blocks:[]};groups.push(group);}group.end=Math.max(group.end,block.endMinute);group.blocks.push(block);}
      for(const group of groups){const ends=[];for(const b of group.blocks){let lane=ends.findIndex(end=>end<=b.startMinute);if(lane<0)lane=ends.length;ends[lane]=b.endMinute;b.lane=lane;}for(const b of group.blocks){
        const button=el('button',undefined,'calendar-event '+b.kind);button.type='button';
        const span=`${clock(b.startMinute)}–${clock(b.endMinute)}`,kind=t[b.kind];
        button.setAttribute('aria-label',`${b.event.summary}, ${day.date}, ${span}, ${kind}`);button.title=`${b.event.summary} · ${span} · ${kind}`;
        button.style.top=`${b.startMinute/60*32}px`;button.style.height=`${Math.max(8,(b.endMinute-b.startMinute)/60*32)}px`;button.style.left=`${b.lane/ends.length*100}%`;button.style.width=`${100/ends.length}%`;
        button.append(el('strong',b.event.summary),el('span',span));
        button.onclick=()=>{details.textContent=`${b.event.summary} · ${day.date} · ${span} · ${b.kind==='proposed'?t[b.section]:kind}`;};column.append(button);
      }}grid.append(column);
    }
    const top=scroll.scrollTop,left=scroll.scrollLeft;scroll.replaceChildren(grid);scroll.setAttribute('aria-label',t.calendar);scroll.tabIndex=0;
    scroll.scrollTop=key?top:6*32;scroll.scrollLeft=left;details.textContent='';
  }
  return {update(value){const next=JSON.stringify(value);if(next===key)return;input=value;render();key=next;}};
}
