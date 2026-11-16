import {mountCalendarWeek} from './calendar-week.js';
import {renderConversation} from './chat-message.js';
const words={
  en:{
    mode:'Managed experimental interface · synthetic data only · scripted/API gateway route; Luna not connected',
    hostMode:'Host Luna fallback · GPT-6 Luna · synthetic data only · DSH/controller on host, Calendarpit in Docker; restart recovery is limited',
    start:'Start selected scenario',retire:'End and archive run',refresh:'Refresh',send:'Send',chat:'Plan together',
    calendar:'Your week · calendar and proposal',proposal:'Review proposal',near:'Coming week',future:'Future tentative blocks',
    approveNear:'Approve coming week',approveFuture:'Approve future blocks',applying:'Applying…',
    approvalNote:'Chat messages do not apply calendar changes. Review each section and use its separate approval button.',
    messageLabel:'Your message',showChanges:'Show proposed changes',blocks:'blocks',hours:'study hours',noEvents:'Start a synthetic run to inspect its calendar.',working:'The agent is working…',waiting:'Your answer is needed. The execution timer is paused while you answer.',ready:'Ready for your next message.',approved:'Approved changes applied.',answer:'Send answer',sent:'Message sent.',answered:'Answer sent.',started:'Synthetic run started.',
    archived:'Run archived.',refreshed:'View refreshed.',none:'No active run',
    blocked:'Recorded run is blocked or needs inspection. Preserve its evidence before replacement.',
    unknown:'Calendar unavailable; its current contents are unknown.',
    confirm:'End this synthetic run and archive its evidence?',pending:'pending',applied:'applied',rejected:'rejected',applyingStatus:'applying'
  },
  pt:{
    mode:'Interface gerenciada experimental · apenas dados sintéticos · rota de gateway; Luna ainda não conectada',
    hostMode:'Fallback Luna no host · GPT-6 Luna · apenas dados sintéticos · DSH/controlador no host, Calendarpit no Docker; recuperação após reinício é limitada',
    start:'Iniciar cenário selecionado',retire:'Encerrar e arquivar',refresh:'Atualizar',send:'Enviar',chat:'Planejar em conjunto',
    calendar:'Sua semana · calendário e proposta',proposal:'Revisar proposta',near:'Próxima semana',future:'Blocos futuros provisórios',
    approveNear:'Aprovar próxima semana',approveFuture:'Aprovar blocos futuros',applying:'Aplicando…',
    approvalNote:'Mensagens no chat não alteram o calendário. Revise cada seção e use o botão de aprovação correspondente.',
    messageLabel:'Sua mensagem',showChanges:'Mostrar alterações propostas',blocks:'blocos',hours:'horas de estudo',noEvents:'Inicie uma execução sintética para visualizar o calendário.',working:'O agente está trabalhando…',waiting:'Sua resposta é necessária. O tempo de execução fica pausado enquanto você responde.',ready:'Pronto para sua próxima mensagem.',approved:'Alterações aprovadas e aplicadas.',answer:'Enviar resposta',sent:'Mensagem enviada.',answered:'Resposta enviada.',started:'Execução sintética iniciada.',
    archived:'Execução arquivada.',refreshed:'Visualização atualizada.',none:'Nenhuma execução ativa',
    blocked:'Execução bloqueada ou pendente de inspeção. Preserve as evidências antes de substituí-la.',
    unknown:'Calendário indisponível; seu conteúdo atual é desconhecido.',
    confirm:'Encerrar a execução sintética e arquivar as evidências?',pending:'pendente',applied:'aplicado',rejected:'rejeitado',applyingStatus:'aplicando'
  }
};
const $=id=>document.getElementById(id);
let run=null,available=false,busy=false,questionKey='',messagesKey='',calendarKey='',proposalKey='',lastState=null,runtime='managed-gateway';
let calendarView=null;
const approvalBusy=new Set(),approvalCompleted=new Set();
const t=key=>words[$('language').value][key];
function node(tag,text){const element=document.createElement(tag);element.textContent=text;return element;}
async function api(route,data){
  const method=data?'POST':'GET',query=data?'':'?'+new URLSearchParams(run?{runId:run.id}:{});
  const response=await fetch('/api/'+route+query,{method,...(data?{headers:{'content-type':'application/json'},body:JSON.stringify({runId:run?.id,...data})}:{})});
  const body=await response.json();if(!response.ok)throw Error(body.error);return body;
}
function showNotice(message){$('notice').textContent=message||'';}
async function action(fn,success){
  try {const result=await fn();if(success)showNotice(success);return result;}
  catch(error){showNotice(error.message);return undefined;}
}
function labels(){
  document.documentElement.lang=$('language').value==='pt'?'pt-BR':'en';
  for(const [id,key] of [['mode','mode'],['start','start'],['retire','retire'],['refresh','refresh'],['send','send'],['chat-title','chat'],['calendar-title','calendar'],['proposal-title','proposal'],['message-label','messageLabel']])if($(id))$(id).textContent=t(key);
  $('mode').textContent=t(runtime==='host-luna-fallback'?'hostMode':'mode');
  if($('approval-note'))$('approval-note').textContent=t('approvalNote');
}
function canApprove(state,plan,section){
  const changes=(plan[section]?.length||0)+(plan.remove?.[section]?.length||0)>0;
  return available&&plan.status?.[section]==='pending'&&!state.recovery&&state.calendar?.availability==='available'&&changes&&
    !approvalBusy.has(`${plan.id}:${section}`)&&!approvalCompleted.has(`${plan.id}:${section}`);
}
function renderMessages(messages){
  const key=JSON.stringify([run?.id,$('language').value,messages]);if(key===messagesKey)return;
  messagesKey=key;const out=$('messages'),nearBottom=out.scrollHeight-out.scrollTop-out.clientHeight<80;renderConversation(out,messages,$('language').value);if(nearBottom)out.scrollTop=out.scrollHeight;
}
function renderQuestion(question){
  const key=JSON.stringify([run?.id,$('language').value,question]);if(key===questionKey)return;
  questionKey=key;$('question').replaceChildren();if(!question)return;
  const form=node('form',''),inputs=[];
  for(const item of question.questions){
    form.append(node('p',item.question));
    if(item.options?.length)form.append(node('small',item.options.map(option=>option.label).join(' · ')));
    const input=node('textarea','');input.required=true;form.append(input);inputs.push({id:item.id,input});
  }
  const button=node('button',t('answer'));form.append(button);
  form.onsubmit=event=>{event.preventDefault();action(async()=>{
    await api('chat/answer',{requestId:question.requestId,answers:inputs.map(({id,input})=>({id,selected:[],custom:input.value}))});
    await refresh();
  },t('answered'));};
  $('question').append(form);
}
function renderCalendar(state){
  const key=JSON.stringify([run?.id,$('language').value,state.events,state.calendar?.availability,state.state?.plan]);if(key===calendarKey)return;
  calendarKey=key;
  if(state.calendar?.availability!=='available'){$('calendar').replaceChildren(node('p',t('unknown')));calendarView=null;return;}
  if(!calendarView)calendarView=mountCalendarWeek($('calendar'));
  calendarView.update({events:state.events||[],plan:state.state?.plan,language:$('language').value});
}
function renderProposal(state){
  const plan=state.state?.plan,key=JSON.stringify([run?.id,$('language').value,plan,state.recovery,state.calendar]);
  if(key===proposalKey)return;
  proposalKey=key;$('proposal').replaceChildren();if(!plan)return;
  for(const section of ['near','future']){
    const box=node('section','');box.className='proposal-section';
    const label=section==='near'?'near':'future';
    const status=plan.status?.[section];
    box.append(node('h3',`${t(label)} · ${t(status)||status||''}`));
    const blocks=plan[section]||[],minutes=blocks.reduce((sum,event)=>sum+(event.start?.dateTime&&event.end?.dateTime?(Date.parse(event.end.dateTime)-Date.parse(event.start.dateTime))/60000:0),0);
    box.append(node('p',`${blocks.length} ${t('blocks')} · ${Number((minutes/60).toFixed(2))} ${t('hours')}`));
    const changes=node('details',''),summary=node('summary',t('showChanges')),list=node('ul','');changes.append(summary,list);
    const format=value=>value?new Intl.DateTimeFormat($('language').value==='pt'?'pt-BR':'en',{timeZone:'America/Sao_Paulo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'';
    for(const event of blocks)list.append(node('li',`${format(event.start?.dateTime)} · ${event.summary||''}`));
    for(const event of plan.remove?.[section]||[])list.append(node('li',`− ${format(event.start?.dateTime)} · ${event.summary||''}`));
    box.append(changes);
    const approve=node('button',t(section==='near'?'approveNear':'approveFuture'));
    const approvalKey=`${plan.id}:${section}`;approve.disabled=!canApprove(state,plan,section);
    if(approvalBusy.has(approvalKey))approve.textContent=t('applying');
    approve.onclick=async()=>{
      if(!canApprove(lastState||state,plan,section))return;
      approvalBusy.add(approvalKey);approve.disabled=true;approve.textContent=t('applying');showNotice(t('applying'));
      try {
        await api('approve',{planId:plan.id,section});approvalCompleted.add(approvalKey);
        await refresh();showNotice(t('approved'));
      } catch(error) {
        const message=error.message;
        try {await refresh();} catch {}
        showNotice(message);
      } finally {
        approvalBusy.delete(approvalKey);
        if(approve.isConnected){
          approve.textContent=t(section==='near'?'approveNear':'approveFuture');
          approve.disabled=!lastState?.state?.plan||lastState.state.plan.id!==plan.id||!canApprove(lastState,lastState.state.plan,section);
        }
      }
    };
    box.append(approve);$('proposal').append(box);
  }
}
function clearUnavailable(){
  for(const id of ['messages','question','calendar','proposal'])if($(id).children.length)$(id).replaceChildren();
  messagesKey=questionKey=calendarKey=proposalKey='';lastState=null;calendarView=null;$('calendar').append(node('p',t('noEvents')));
}
async function refresh(){
  const status=await api('run');run=status.run;available=status.available;runtime=status.runtime||'managed-gateway';labels();
  $('run').textContent=run?`${run.student} · ${run.id} · ${run.phase}`:t('none');
  $('start').disabled=!!run;$('retire').disabled=!run;$('student').disabled=!!run||runtime==='host-luna-fallback';$('send').disabled=!available||busy;
  $('run-warning').textContent=run&&!available?t('blocked'):'';
  if(!available){clearUnavailable();return;}
  const [chat,state]=await Promise.all([api('chat/state'),api('status')]);busy=chat.busy;$('send').disabled=busy;
  lastState=state;
  if($('chat-progress'))$('chat-progress').textContent=t(chat.question?'waiting':busy?'working':'ready');
  renderMessages(chat.messages);renderQuestion(chat.question);renderCalendar(state);renderProposal(state);
  if(chat.error)showNotice(chat.error);
}
$('language').onchange=()=>{labels();action(refresh);};
$('refresh').onclick=()=>action(refresh,t('refreshed'));
$('start').onclick=()=>action(async()=>{await api('run/start',{student:$('student').value});await refresh();},t('started'));
$('retire').onclick=()=>{const runId=run?.id;if(confirm(t('confirm')))action(async()=>{await api('run/retire',{runId});run=null;await refresh();},t('archived'));};
$('chat').onsubmit=event=>{event.preventDefault();const text=$('text').value;action(async()=>{await api('chat/send',{text});$('text').value='';await refresh();},t('sent'));};
labels();await action(refresh);let polling=false;setInterval(async()=>{if(polling)return;polling=true;try{await refresh();}catch(error){showNotice(error.message);}finally{polling=false;}},2000);
