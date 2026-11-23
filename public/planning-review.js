const words={
  en:{header:'Planning inputs',pending:'Review these inputs',saved:'Confirmed inputs',expired:'Expired preference',confirm:'Confirm planning inputs',
    note:'This confirms deadlines and preferences. Calendar changes have their own approval.',source:'Read source',page:'page',
    evidence:'Source evidence',dates:'Assessment dates',windows:'Study windows',hours:'hours per week',day:'hours per day',
    break:'minute break',through:'Preferences valid through',inclusive:'inclusive',changes:'Changes since the previous revision',added:'Added',removed:'Removed',
    replies:'Original replies',prior:'Previously confirmed',proposed:'Proposed preference',load:'Workload or scope changed',datesChanged:'Assessment evidence or dates changed',
    captureError:'Source unavailable',noContext:'The agent will propose cited dates and preferences here.'},
  pt:{header:'Dados para o planejamento',pending:'Revise estes dados',saved:'Dados confirmados',expired:'Preferência expirada',confirm:'Confirmar dados do plano',
    note:'Isto confirma prazos e preferências. Alterações no calendário têm aprovação separada.',source:'Ler fonte',page:'página',
    evidence:'Trecho da fonte',dates:'Datas das avaliações',windows:'Janelas de estudo',hours:'horas por semana',day:'horas por dia',
    break:'minutos de pausa',through:'Preferências válidas até',inclusive:'inclusive',changes:'Mudanças desde a revisão anterior',added:'Adicionado',removed:'Removido',
    replies:'Respostas originais',prior:'Confirmado anteriormente',proposed:'Preferência proposta',load:'Carga ou escopo alterado',datesChanged:'Datas ou fontes alteradas',
    captureError:'Fonte indisponível',noContext:'O agente apresentará aqui as datas citadas e as preferências.'},
};

const properties=['targetHours','maxDailyStudyHours','studyBreakMinutes','through'];
const windowKey=value=>[value.weekday,value.start,value.end].join(' ');

export function planningContextChanges(previous,current) {
  if(!previous) return null;
  const before=new Set(previous.studyWindows.map(windowKey));
  const after=new Set(current.studyWindows.map(windowKey));
  return {
    added:current.studyWindows.filter(window=>!before.has(windowKey(window))),
    removed:previous.studyWindows.filter(window=>!after.has(windowKey(window))),
    workload:properties.some(key=>previous[key]!==current[key]),
    dates:JSON.stringify(previous.courses)!==JSON.stringify(current.courses),
  };
}

export function courseMinutes(sources,events) {
  const count=new Map((sources||[]).map(source=>[source.name,0]));
  for(const event of events||[]){
    const name=event.extendedProperties?.private?.course;
    const minutes=(Date.parse(event.end?.dateTime)-Date.parse(event.start?.dateTime))/60000;
    if(name&&Number.isFinite(minutes)&&minutes>0)count.set(name,(count.get(name)||0)+minutes);
  }
  return [...count];
}

export function mountPlanningReview(root) {
  const document=root.ownerDocument;
  const el=(type,text)=>{const node=document.createElement(type);if(text!==undefined)node.textContent=text;return node;};
  let key='';
  return ({context,language,replies,locked,confirm,read})=>{
    const next=JSON.stringify([context,language,replies,locked]);
    if(next===key)return;
    key=next;
    root.replaceChildren();
    root.hidden=!context;
    if(!context)return;
    const t=words[language],locale=language==='pt'?'pt-BR':'en';
    const revision=context.pending||context.confirmed;
    root.append(el('h2',t.header));
    if(!revision){root.append(el('p',t.noContext));return;}
    const r=revision.record;
    const pending=context.pending?.id===revision.id;
    root.append(el('p',pending?t.pending:revision.expired?t.expired:t.saved));
    const weekday=new Intl.DateTimeFormat(locale,{weekday:'long',timeZone:'UTC'});
    const formatWindow=window=>`${weekday.format(new Date(Date.UTC(2026,10,1+window.weekday)))} · ${window.start}–${window.end}`;
    const diff=planningContextChanges(context.previous?.record,r);
    if(diff&&(diff.added.length||diff.removed.length||diff.workload||diff.dates)){
      const changes=el('div');changes.className='context-changes';
      changes.append(el('h3',t.changes));
      for(const window of diff.removed)changes.append(el('p',`${t.removed} · ${formatWindow(window)}`));
      for(const window of diff.added)changes.append(el('p',`${t.added} · ${formatWindow(window)}`));
      if(diff.workload)changes.append(el('p',t.load));
      if(diff.dates)changes.append(el('p',t.datesChanged));
      root.append(changes);
    }
    const cards=el('div');cards.className='context-columns';
    const deadlines=el('div'),availability=el('div');
    deadlines.append(el('h3',t.dates));
    const date=new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',timeZone:'UTC'});
    const formatDate=value=>date.format(new Date(value+'T12:00:00Z'));
    for(const course of r.courses){
      const block=el('div');block.className='context-course';
      const cite=course.citation;
      block.append(el('strong',`${course.name} · ${formatDate(course.date)} ${course.time}`));
      const details=el('details'),title=el('summary',cite.path+(cite.page?` · ${t.page} ${cite.page}`:''));
      details.append(title,el('blockquote',cite.quote));
      if(course.resolution)details.append(el('p',course.resolution));
      const load=el('button',t.source),body=el('pre');body.hidden=true;
      load.type='button';
      load.onclick=async()=>{
        load.disabled=true;
        try{
          const {result}=await read(cite.path);
          body.textContent=cite.page?result.split('\f')[cite.page-1]:result;
        }catch{body.textContent=t.captureError;}
        finally{body.hidden=false;load.disabled=false;}
      };
      details.append(load,body);block.append(details);deadlines.append(block);
    }
    availability.append(el('h3',t.windows),el('p',`${r.targetHours} ${t.hours} · ${r.maxDailyStudyHours} ${t.day} · ${r.studyBreakMinutes} ${t.break}`),
      el('p',`${t.through} ${formatDate(r.through)} (${t.inclusive})`));
    const windows=el('ul');
    for(const window of r.studyWindows)windows.append(el('li',formatWindow(window)));
    availability.append(windows);
    cards.append(deadlines,availability);
    root.append(cards);
    const priorAssumption=pending&&context.confirmed?.record.assumption;
    if(priorAssumption&&priorAssumption!==r.assumption){
      const comparison=el('div');comparison.className='context-changes';
      comparison.append(el('h3',t.prior),el('p',priorAssumption),el('h3',t.proposed),el('p',r.assumption));
      root.append(comparison);
    }else root.append(el('p',r.assumption));
    const savedReplies=revision.operatorReplies??(pending?replies:[]);
    if(savedReplies?.length){
      const original=el('details');original.append(el('summary',t.replies));
      for(const reply of savedReplies)original.append(el('p',reply));
      root.append(original);
    }
    if(pending){
      const note=el('p',t.note);note.className='review-note';
      const button=el('button',t.confirm);button.type='button';button.disabled=locked;
      button.onclick=()=>confirm(revision.id);
      root.append(note,button);
    }
  };
}
