import React from 'react';
import {contribution} from './panel-descriptor.mjs';
import {panelData,eventPresentation,hourLabels,viewNotices,eventTypeLabels} from './panel-view.mjs';
const h=React.createElement;
const id='study-calendar-browser-spike';
const isPt=()=>globalThis.navigator?.language?.toLowerCase().startsWith('pt');
const label=(en,pt)=>isPt()?pt:en;
function Calendar({remote}){
 const [state,setState]=React.useState({loading:true});
 React.useEffect(()=>{let active=true;remote.view().then(result=>{if(active)setState(result.ok?{data:result.value}:{error:result.error?.message||'Unavailable'});}).catch(()=>{if(active)setState({error:'Unavailable'});});return()=>{active=false;};},[remote]);
 if(state.loading)return h('p',{role:'status'},label('Loading synthetic calendar…','Carregando calendário sintético…'));
 if(state.error)return h('p',{role:'alert'},label('Calendar unavailable: ','Calendário indisponível: ')+state.error);
 let view;try{view=panelData(state.data);}catch{return h('p',{role:'alert'},label('Unsupported calendar or proposal data.','Dados do calendário ou da proposta não suportados.'));}
 const events=view.events;const colors={existing:'#cce8da',add:'#dceaff'};
 const days=label(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']);
 return h('section',{style:{padding:12,fontFamily:'sans-serif',color:'#17352c'}},
 h('h2',null,label('Synthetic calendar','Calendário sintético')),
 h('p',{role:'status'},state.data.stale?label('Proposal is stale; refresh before review.','Proposta desatualizada; atualize antes de revisar.'):label('Read-only preview; changes need separate review.','Prévia somente leitura; alterações exigem revisão separada.')),
 h('p',null,label('Point-in-time snapshot; later changes may not appear.','Retrato de um momento; alterações posteriores podem não aparecer.')),
 h('p',null,viewNotices[isPt()?'pt':'en'].availability),
 h('p',null,viewNotices[isPt()?'pt':'en'].short),
 h('p',null,label('2–8 November 2026 · São Paulo','2–8 de novembro de 2026 · São Paulo')),
 h('div',{role:'group','aria-label':label('Calendar legend','Legenda do calendário'),style:{display:'flex',gap:12,alignItems:'center'}},
  ...['existing','add'].map(kind=>h('span',{key:kind,style:{display:'inline-flex',gap:4,alignItems:'center'}},
   h('span',{'aria-hidden':true,style:{width:12,height:12,display:'inline-block',background:colors[kind],border:'1px solid #70837a'}}),eventTypeLabels[isPt()?'pt':'en'][kind]))),
 h('p',null,label('Only same-day timed events in this week are shown. Events starting and ending in the same minute are omitted; overlaps may cover one another.','Apenas eventos com horário que começam e terminam no mesmo dia são exibidos nesta semana. Eventos que começam e terminam no mesmo minuto são omitidos; eventos sobrepostos podem encobrir uns aos outros.')),
 h('div',{style:{display:'grid',gridTemplateColumns:'46px repeat(7, 86px)',overflowX:'auto'}},
 h('div',{'aria-hidden':true},h('strong',null,label('Time','Hora')),h('div',{style:{height:480,position:'relative'}},...hourLabels().map((text,hour)=>h('span',{key:text,style:{position:'absolute',top:hour*20,fontSize:9}},text)))),
 ...days.map((day,i)=>h('div',{key:day},h('strong',null,day),h('div',{style:{height:480,position:'relative',borderLeft:'1px solid #ddd'}},...events.map(e=>{const display=eventPresentation(e,isPt());if(!display||display.day!==i)return null;return h('div',{key:e.id||e.summary,title:display.accessibleText,'aria-label':display.accessibleText,role:'note',tabIndex:0,style:{position:'absolute',left:1,right:1,top:display.visibleTop,height:display.visibleHeight,overflow:'hidden',background:colors[e.kind]}},h('span',{style:{display:'block',fontSize:9,lineHeight:'10px'}},display.timeRange),h('span',{style:{display:'block',fontSize:10,lineHeight:'10px'}},display.label))}))))),
 h('h3',null,label('Proposal','Proposta')),h('p',null,label('Proposed blocks: ','Blocos propostos: ')+view.proposedCount),
 view.description?h('p',null,label('Description: ','Descrição: ')+view.description):null,
 view.sources.length?h('p',null,label('Sources: ','Fontes: ')+view.sources.join(', ')):null,
 view.assumptions.length?h('ul',null,...view.assumptions.map((a,i)=>h('li',{key:i},a))):null);
}
export const inject=['slots','sidebarRightTabs','remote'];
export async function apply(ctx){
 const unmount=await ctx.remote.$mount(contribution);
 ctx.effect(()=>()=>unmount(),'study-panel: remote');
 ctx.effect(()=>ctx.sidebarRightTabs.register({id,kind:'study-calendar-browser',title:()=>label('Study calendar','Calendário de estudos'),guide:[{id:'open',title:()=>label('Study calendar','Calendário de estudos'),description:()=>label('Synthetic read-only calendar','Calendário sintético somente leitura')}]}),'study-panel: tab');
 ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:id},()=>h(Calendar,{remote:ctx.remote.calendarSpike})));
}
