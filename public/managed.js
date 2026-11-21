import {mountCalendarWeek} from './calendar-week.js';
import {mountPlanningReview,courseMinutes} from './planning-review.js';
import {renderConversation} from './chat-message.js';
const words={
  en:{
    weekLink:'Week',chatLink:'Conversation',questionLink:'Answer question',mode:'Managed experimental interface · synthetic data only · scripted/API gateway route; Luna not connected',
    scriptedMode:'Scripted browser exercise · synthetic data',
    hostMode:'Host Luna fallback · GPT-6 Luna · synthetic data only · DSH/controller on host, Calendarpit in Docker; restart recovery is limited',
    localAccess:'Open the live controls directly in a browser on the facilitator computer using its loopback address. Phone or embedded previews are not supported for control.',
    invalidResponse:'The preview or server returned an empty or invalid response',unconfirmed:'Could not confirm the operation. Refresh and inspect the run before retrying; changes may have occurred.',connectionError:'Could not reach the local service.',requestFailed:'Request failed',
    planningInputs:'Planning inputs',reviewInputs:'Confirm the planning inputs to continue.',inputsConfirmed:'Planning inputs confirmed. Ask for a draft.',
    windowOk:'No current overlap',windowUnknown:'Calendar unavailable · choose a typed answer',windowConflict:'Overlaps',
    start:'Start selected scenario',retire:'End and archive run',refresh:'Refresh',send:'Send',chat:'Plan together',
    calendar:'Your week · calendar and proposal',proposal:'Review proposal',near:'Coming week',future:'Future tentative blocks',
    approveNear:'Approve coming week',approveFuture:'Approve future blocks',applying:'Applying…',
    approvalNote:'Chat messages do not apply calendar changes. Review each section and use its separate approval button.',
    messageLabel:'Your message',showChanges:'Show proposed changes',blocks:'blocks',hours:'study hours',noEvents:'Start a synthetic run to inspect its calendar.',working:'The agent is working…',waiting:'Your answer is needed. The execution timer is paused while you answer.',ready:'Ready for your next message.',typeInstead:'Type a different answer',otherAnswer:'Other answer (optional for multiple selection)',typedAnswer:'Your answer',dismissQuestion:'Dismiss question',questionDismissed:'Question dismissed. Calendar changes were not approved.',answerRequired:'Choose an option or type an answer for every question.',answerTooLong:'Keep each typed answer within 2000 characters.',approved:'Approved changes applied.',answer:'Send answer',sent:'Message sent.',answered:'Answer sent. Calendar approval remains separate.',started:'Synthetic run started.',
    archived:'Run archived.',refreshed:'View refreshed.',none:'No active run',
    blocked:'Recorded run is blocked or needs inspection. Preserve its evidence before replacement.',
    unknown:'Calendar unavailable; its current contents are unknown.',
    recovery:'Calendar changes need recovery inspection. Approval is disabled; preserve the run and contact a maintainer before retrying.',
    confirmArchive:'Confirm end and archive',keepRun:'Keep run open',retiring:'Archiving and verifying retirement…',runChanged:'The selected run changed. Review the current run before ending it.',confirm:'End this synthetic run and archive its evidence?',pending:'pending',applied:'applied',rejected:'rejected',applyingStatus:'applying'
  },
  pt:{
    weekLink:'Semana',chatLink:'Conversa',questionLink:'Responder pergunta',mode:'Interface gerenciada experimental · apenas dados sintéticos · rota de gateway; Luna ainda não conectada',
    scriptedMode:'Exercício guiado no navegador · dados sintéticos',
    hostMode:'Fallback Luna no host · GPT-6 Luna · apenas dados sintéticos · DSH/controlador no host, Calendarpit no Docker; recuperação após reinício é limitada',
    localAccess:'Abra os controles diretamente em um navegador na máquina do facilitador pelo endereço local. Prévias no celular ou incorporadas não permitem controlar a execução.',
    invalidResponse:'A prévia ou o servidor retornou uma resposta vazia ou inválida',unconfirmed:'Não foi possível confirmar a operação. Atualize e confira a execução antes de tentar novamente; pode ter ocorrido uma alteração.',connectionError:'Não foi possível acessar o serviço local.',requestFailed:'A solicitação falhou',
    planningInputs:'Dados do plano',reviewInputs:'Confirme os dados do plano para continuar.',inputsConfirmed:'Dados do plano confirmados. Solicite uma proposta.',
    windowOk:'Sem sobreposição atual',windowUnknown:'Calendário indisponível · digite uma resposta',windowConflict:'Sobreposição com',
    start:'Iniciar cenário selecionado',retire:'Encerrar e arquivar',refresh:'Atualizar',send:'Enviar',chat:'Planejar em conjunto',
    calendar:'Sua semana · calendário e proposta',proposal:'Revisar proposta',near:'Próxima semana',future:'Blocos futuros provisórios',
    approveNear:'Aprovar próxima semana',approveFuture:'Aprovar blocos futuros',applying:'Aplicando…',
    approvalNote:'Mensagens no chat não alteram o calendário. Revise cada seção e use o botão de aprovação correspondente.',
    messageLabel:'Sua mensagem',showChanges:'Mostrar alterações propostas',blocks:'blocos',hours:'horas de estudo',noEvents:'Inicie uma execução sintética para visualizar o calendário.',working:'O agente está trabalhando…',waiting:'Sua resposta é necessária. O tempo de execução fica pausado enquanto você responde.',ready:'Pronto para sua próxima mensagem.',typeInstead:'Digitar outra resposta',otherAnswer:'Outra resposta (opcional na seleção múltipla)',typedAnswer:'Sua resposta',dismissQuestion:'Dispensar pergunta',questionDismissed:'Pergunta dispensada. Nenhuma alteração no calendário foi aprovada.',answerRequired:'Escolha uma opção ou digite uma resposta para cada pergunta.',answerTooLong:'Use até 2000 caracteres em cada resposta digitada.',approved:'Alterações aprovadas e aplicadas.',answer:'Enviar resposta',sent:'Mensagem enviada.',answered:'Resposta enviada. A aprovação do calendário continua separada.',started:'Execução sintética iniciada.',
    archived:'Execução arquivada.',refreshed:'Visualização atualizada.',none:'Nenhuma execução ativa',
    blocked:'Execução bloqueada ou pendente de inspeção. Preserve as evidências antes de substituí-la.',
    unknown:'Calendário indisponível; seu conteúdo atual é desconhecido.',
    recovery:'As alterações no calendário precisam de inspeção de recuperação. A aprovação está desativada; preserve a execução e contate um responsável pela manutenção antes de tentar novamente.',
    confirmArchive:'Confirmar encerramento e arquivar',keepRun:'Manter execução aberta',retiring:'Arquivando e verificando encerramento…',runChanged:'A execução selecionada mudou. Revise a execução atual antes de encerrá-la.',confirm:'Encerrar a execução sintética e arquivar as evidências?',pending:'pendente',applied:'aplicado',rejected:'rejeitado',applyingStatus:'aplicando'
  }
};
const $=id=>document.getElementById(id);
let run=null,available=false,busy=false,questionKey='',messagesKey='',calendarKey='',proposalKey='',lastState=null,runtime='managed-gateway';
const renderPlanning=$('planning-context')?mountPlanningReview($('planning-context')):null;
let contextBusy=false,contextUnconfirmed=null;
let calendarView=null,retireReview=null,retirePending=false,retireReviewKey='',retireConfirmButton=null;
let questionIdentity='',questionEpoch=0,questionPending=false,questionControls=[],questionSubmit=null,questionCancel=null,questionError=null;
const approvalBusy=new Set(),approvalCompleted=new Set(),approvalReviewRequired=new Set();
const t=key=>words[$('language').value][key];
function node(tag,text){const element=document.createElement(tag);element.textContent=text;return element;}
async function api(route,data){
  const method=data?'POST':'GET',query=data?'':(route.includes('?')?'&':'?')+new URLSearchParams(run?{runId:run.id}:{});
  let response;
  try{response=await fetch('/api/'+route+query,{method,...(data?{headers:{'content-type':'application/json'},body:JSON.stringify({runId:run?.id,...data})}:{})});}
  catch{throw Object.assign(Error(`${data?t('unconfirmed')+' ':''}${t('connectionError')} ${t('localAccess')}`),{unconfirmed:!!data});}
  const invalid=()=>Object.assign(Error(`${data?t('unconfirmed')+' ':''}${t('invalidResponse')} (HTTP ${response.status||'unknown'}). ${t('localAccess')}`),{unconfirmed:!!data});
  let body;try{body=await response.json();}catch{throw invalid();}
  if(!data&&route.startsWith('file?')&&response.ok&&typeof body==='string')return body;
  if(!body||typeof body!=='object'||Array.isArray(body))throw invalid();
  if(!response.ok){
    if(data&&body.outcome==='unconfirmed')throw Object.assign(Error(t('unconfirmed')),{unconfirmed:true});
    if(response.status===401||response.status===403)throw Error(`${t('requestFailed')} (HTTP ${response.status}). ${t('localAccess')}`);
    throw Error(typeof body.error==='string'?body.error:t('requestFailed'));
  }
  return body;
}
function showNotice(message){$('notice').textContent=message||'';}
async function action(fn,success){
  try {const result=await fn();if(success)showNotice(success);return result;}
  catch(error){showNotice(error.message);return undefined;}
}
function labels(){
  document.documentElement.lang=$('language').value==='pt'?'pt-BR':'en';
  for(const [id,key] of [['mode','mode'],['access-note','localAccess'],['start','start'],['retire','retire'],['refresh','refresh'],['send','send'],['chat-title','chat'],['calendar-title','calendar'],['proposal-title','proposal'],['message-label','messageLabel'],['nav-calendar','weekLink'],['nav-review','proposal']])if($(id))$(id).textContent=t(key);
  $('mode').textContent=t(runtime==='host-luna-fallback'?'hostMode':runtime==='scripted-review'?'scriptedMode':'mode');
  if($('approval-note'))$('approval-note').textContent=t('approvalNote');
  renderRetireReview();
}
function renderRetireReview(){
  const panel=$('retire-confirm');if(!panel)return;
  const key=JSON.stringify([retireReview,retirePending,$('language').value]);
  if(key===retireReviewKey)return retireConfirmButton;
  retireReviewKey=key;retireConfirmButton=null;
  panel.setAttribute('aria-label',t('confirm'));panel.replaceChildren();panel.hidden=!retireReview;if(!retireReview)return;
  const review=retireReview;
  panel.append(node('h3',t('confirm')),node('p',`${review.student} · ${review.id}`));
  const confirmButton=node('button',t(retirePending?'retiring':'confirmArchive')),cancelButton=node('button',t('keepRun'));
  confirmButton.type=cancelButton.type='button';confirmButton.disabled=cancelButton.disabled=retirePending;
  cancelButton.onclick=()=>{if(retirePending)return;retireReview=null;renderRetireReview();$('retire').focus();};
  confirmButton.onclick=async()=>{
    if(retirePending)return;
    if(!run||run.id!==review.id||retireReview?.id!==review.id){retireReview=null;renderRetireReview();showNotice(t('runChanged'));return;}
    retirePending=true;renderRetireReview();$('retire').disabled=true;
    try{await api('run/retire',{runId:review.id});retireReview=null;run=null;await refresh();showNotice(t('archived'));}
    catch(error){showNotice(error.message);try{await refresh();}catch{}}
    finally{retirePending=false;renderRetireReview();$('retire').disabled=!run||retirePending;}
  };
  panel.append(confirmButton,cancelButton);retireConfirmButton=confirmButton;return confirmButton;
}
function canApprove(state,plan,section){
  const changes=(plan[section]?.length||0)+(plan.remove?.[section]?.length||0)>0;
  return available&&plan.status?.[section]==='pending'&&!state.recovery&&state.calendar?.availability==='available'&&changes&&!state.state?.planningContext?.pending&&
    !approvalBusy.has(`${plan.id}:${section}`)&&!approvalCompleted.has(`${plan.id}:${section}`)&&!approvalReviewRequired.has(`${plan.id}:${section}`);
}
function renderMessages(messages){
  const key=JSON.stringify([run?.id,$('language').value,messages]);if(key===messagesKey)return;
  messagesKey=key;const out=$('messages'),nearBottom=out.scrollHeight-out.scrollTop-out.clientHeight<80;renderConversation(out,messages,$('language').value);if(nearBottom)out.scrollTop=out.scrollHeight;
}
function questionDraft(){
  return new Map(questionControls.map(control=>[control.id,{
    selected:control.options.filter(option=>option.input.checked).map(option=>option.label),
    custom:control.text.value,customMode:control.other?.checked??true
  }]));
}
function setQuestionPending(value){
  questionPending=value;
  for(const control of questionControls)control.field.disabled=value;
  if(questionSubmit)questionSubmit.disabled=value;
  if(questionCancel)questionCancel.disabled=value;
}
function chatShortcut(question){
  const link=$('nav-chat');
  if(link){
    link.href=question?'#question':'#chat-title';
    link.textContent=t(question?'questionLink':'chatLink');
  }
}
function visibleOptions(question,state){
  if(!question||!state?.availabilityOptions)return [];
  const labels=question.questions.flatMap(item=>(item.options||[]).map(option=>option.label));
  return state.availabilityOptions.options.filter(option=>labels.includes(option.label));
}
function renderQuestion(question,state){
  const options=visibleOptions(question,state);
  const previewId=options.length?state.availabilityOptions.id:undefined;
  chatShortcut(question);
  const identity=question?JSON.stringify([run?.id,question.requestId]):'';
  const key=JSON.stringify([identity,$('language').value,question,previewId,options]);if(key===questionKey)return;
  const draft=identity===questionIdentity?questionDraft():new Map();
  if(identity!==questionIdentity){questionEpoch++;questionPending=false;}
  questionIdentity=identity;questionKey=key;questionControls=[];$('question').replaceChildren();
  if(!question){questionSubmit=questionCancel=questionError=null;return;}
  const epoch=questionEpoch,form=node('form','');form.className='question-form';
  questionError=node('p','');questionError.id=`question-error-${epoch}`;questionError.setAttribute('role','alert');
  question.questions.forEach((item,index)=>{
    const field=node('fieldset',''),legend=node('legend',item.question);field.append(legend);
    if(item.detail)field.append(node('p',item.detail));
    const prior=draft.get(item.id),control={id:item.id,field,options:[],other:null,text:null,multi:!!item.multiSelect};
    const name=`question-${epoch}-${index}`;
    const choose=selected=>{for(const option of control.options)option.input.checked=option.input===selected;if(control.other)control.other.checked=control.other===selected;};
    for(const [optionIndex,option] of (item.options||[]).entries()){
      const label=node('label',''),input=node('input','');label.className='question-option';
      input.type=item.multiSelect?'checkbox':'radio';input.name=name;input.id=`${name}-${optionIndex}`;input.value=option.label;
      input.checked=!!prior?.selected.includes(option.label)&&(!prior.customMode||!!item.multiSelect);
      if(!item.multiSelect)input.onchange=()=>{if(input.checked)choose(input);};
      const text=node('span',option.label+(option.description?' — '+option.description:''));
      const candidate=options.find(item=>item.label===option.label);
      if(candidate){
        const list=node('ul','');list.className='option-windows';
        for(const window of candidate.windows){
          const status=window.conflicts===null?t('windowUnknown'):window.conflicts.length?`${t('windowConflict')} ${window.conflicts.map(x=>x.summary).join(', ')}`:t('windowOk');
          const range=node('li',`${window.date} · ${window.start}–${window.end} · ${status}`);
          if(window.conflicts===null||window.conflicts.length){range.className='window-warning';input.disabled=true;input.checked=false;}
          list.append(range);
        }
        text.append(list);
      }
      label.append(input,text);field.append(label);
      control.options.push({label:option.label,input});
    }
    const customLabel=node('label',t(control.multi?'otherAnswer':'typedAnswer'));customLabel.className='question-custom';
    const input=node('textarea','');input.id=`${name}-custom`;input.name=`${name}-custom`;input.maxLength=2000;input.value=prior?.custom||'';
    if(control.options.length&&!item.multiSelect){
      const label=node('label',''),other=node('input','');label.className='question-option';other.type='radio';other.name=name;other.value='__custom__';other.checked=!!prior?.customMode;
      other.onchange=()=>{if(other.checked)choose(other);};control.other=other;
      label.append(other,node('span',t('typeInstead')));field.append(label);
      input.oninput=()=>choose(other);input.onfocus=()=>choose(other);
    }
    control.text=input;customLabel.append(input);field.append(customLabel);form.append(field);questionControls.push(control);
  });
  questionSubmit=node('button',t('answer'));questionSubmit.type='submit';
  questionCancel=node('button',t('dismissQuestion'));questionCancel.type='button';
  form.append(questionError,questionSubmit,questionCancel);
  form.onsubmit=async event=>{
    event.preventDefault();if(epoch!==questionEpoch||!form.isConnected||questionPending)return;
    const answers=[];
    for(const control of questionControls){
      const useCustom=!control.options.length||control.multi||control.other.checked;
      const selected=useCustom&&!control.multi?[]:control.options.filter(option=>option.input.checked).map(option=>option.label);
      const custom=useCustom?control.text.value.trim():'';
      if((!selected.length&&!custom)||custom.length>2000){
        questionError.textContent=t(custom.length>2000?'answerTooLong':'answerRequired');
        (useCustom?control.text:control.options[0]?.input||control.text).focus();return;
      }
      answers.push({id:control.id,selected,...(custom?{custom}:{})});
    }
    questionError.textContent='';setQuestionPending(true);
    try{await api('chat/answer',{requestId:question.requestId,answers,...(previewId?{previewId}:{})});showNotice(t('answered'));await refresh();}
    catch(error){if(epoch===questionEpoch){questionError.textContent=error.message;showNotice(error.message);}try{await refresh();}catch{}}
    finally{if(epoch===questionEpoch)setQuestionPending(false);}
  };
  questionCancel.onclick=async()=>{
    if(epoch!==questionEpoch||!form.isConnected||questionPending)return;
    setQuestionPending(true);
    try{await api('chat/cancel-question',{requestId:question.requestId});showNotice(t('questionDismissed'));await refresh();}
    catch(error){if(epoch===questionEpoch){questionError.textContent=error.message;showNotice(error.message);}try{await refresh();}catch{}}
    finally{if(epoch===questionEpoch)setQuestionPending(false);}
  };
  $('question').append(form);setQuestionPending(questionPending);
}
function renderCalendar(state,options=[]){
  const key=JSON.stringify([run?.id,$('language').value,state.events,state.calendar?.availability,state.state?.plan,options]);if(key===calendarKey)return;
  calendarKey=key;
  if(state.calendar?.availability!=='available'){$('calendar').replaceChildren(node('p',t('unknown')));calendarView=null;return;}
  if(!calendarView)calendarView=mountCalendarWeek($('calendar'));
  calendarView.update({events:state.events||[],plan:state.state?.plan,options,language:$('language').value});
}
function renderProposal(state){
  const plan=state.state?.plan,key=JSON.stringify([run?.id,$('language').value,plan,state.recovery,state.calendar,state.state?.planningContext?.pending?.id]);
  if(key===proposalKey)return;
  proposalKey=key;$('proposal').replaceChildren();if(!plan)return;
  for(const section of ['near','future']){
    const box=node('section','');box.className='proposal-section';
    const label=section==='near'?'near':'future';
    const status=plan.status?.[section];
    box.append(node('h3',`${t(label)} · ${t(status)||status||''}`));
    const blocks=plan[section]||[],minutes=blocks.reduce((sum,event)=>sum+(event.start?.dateTime&&event.end?.dateTime?(Date.parse(event.end.dateTime)-Date.parse(event.start.dateTime))/60000:0),0);
    box.append(node('p',`${blocks.length} ${t('blocks')} · ${Number((minutes/60).toFixed(2))} ${t('hours')}`));
    if(plan.planningContextRevisionId&&(section==='near'||blocks.length)){
      const coverage=node('ul','');coverage.className='course-coverage';
      const nf=new Intl.NumberFormat($('language').value==='pt'?'pt-BR':'en',{maximumFractionDigits:2});
      for(const [name,minutes] of courseMinutes(plan.sources,blocks))coverage.append(node('li',`${name} · ${nf.format(minutes/60)} h`));
      box.append(coverage);
    }
    const changes=node('details',''),summary=node('summary',t('showChanges')),list=node('ul','');changes.append(summary,list);
    const locale=$('language').value==='pt'?'pt-BR':'en';
    const day=new Intl.DateTimeFormat(locale,{timeZone:'America/Sao_Paulo',month:'short',day:'numeric'});
    const time=new Intl.DateTimeFormat(locale,{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const describe=event=>{
      const start=event.start?.dateTime,end=event.end?.dateTime;
      if(!start)return `${event.start?.date||''} · ${event.summary||''}`;
      const finish=end?(day.format(new Date(start))===day.format(new Date(end))?time.format(new Date(end)):`${day.format(new Date(end))} ${time.format(new Date(end))}`):'';
      return `${day.format(new Date(start))} · ${time.format(new Date(start))}${finish?'–'+finish:''} · ${event.summary||''}`;
    };
    const chronological=(left,right)=>String(left.start?.dateTime||left.start?.date).localeCompare(String(right.start?.dateTime||right.start?.date));
    for(const event of [...blocks].sort(chronological))list.append(node('li',describe(event)));
    for(const event of [...(plan.remove?.[section]||[])].sort(chronological))list.append(node('li',`− ${describe(event)}`));
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
        // Even a fresh pending snapshot can predate a controller write that
        // continued after its response was lost. Require a different proposal.
        if(error.unconfirmed)approvalReviewRequired.add(approvalKey);
        try {await refresh();}
        catch {approvalReviewRequired.add(approvalKey);}
        showNotice(error.message);
      } finally {
        approvalBusy.delete(approvalKey);
        // refresh() may have replaced this button while the operation was pending.
        // Render the current section after clearing the pending key, not the detached control.
        if(lastState){proposalKey='';renderProposal(lastState);}
      }
    };
    box.append(approve);$('proposal').append(box);
    if(status==='pending'&&approvalReviewRequired.has(approvalKey)){
      box.append(node('p',$('language').value==='pt'
        ? 'Confira o calendário e revise uma nova proposta antes de aprovar esta seção.'
        : 'Inspect the calendar and review a new proposal before approving this section.'));
    }
  }
}
function clearUnavailable(){
  chatShortcut(null);
  renderPlanning?.({context:null});
  if($('nav-context'))$('nav-context').hidden=true;
  for(const id of ['messages','question','calendar','proposal'])if($(id).children.length)$(id).replaceChildren();
  messagesKey=questionKey=calendarKey=proposalKey='';questionIdentity='';questionEpoch++;questionPending=false;questionControls=[];lastState=null;calendarView=null;$('calendar').append(node('p',t('noEvents')));
}
async function refresh(){
  const status=await api('run');run=status.run;available=status.available;runtime=status.runtime||'managed-gateway';labels();
  if(retireReview&&retireReview.id!==run?.id&&!retirePending){retireReview=null;renderRetireReview();}
  $('run').textContent=run?`${status.caseId||run.student} · ${run.id} · ${run.phase}`:t('none');
  if(status.student)$('student').value=status.student;
  $('start').disabled=!!run;$('retire').disabled=!run||retirePending;$('student').disabled=!!run||runtime==='host-luna-fallback'||!!status.student;$('send').disabled=!available||busy;
  $('run-warning').textContent=run&&!available?t('blocked'):'';
  if(!available){clearUnavailable();return;}
  const [chat,state]=await Promise.all([api('chat/state'),api('status')]);busy=chat.busy;$('send').disabled=busy;
  lastState=state;
  $('run-warning').textContent=state.recovery?t('recovery'):'';
  const context=state.state?.planningContext;
  if($('chat-progress'))$('chat-progress').textContent=t(chat.question?'waiting':busy?'working':context?.pending?'reviewInputs':'ready');
  if($('nav-context')){
    $('nav-context').hidden=!context;
    $('nav-context').textContent=t('planningInputs');
  }
  const displayedRun=run.id;
  renderPlanning?.({
    context,language:$('language').value,locked:busy||contextBusy||context?.pending?.id===contextUnconfirmed,
    replies:context?chat.messages.filter(message=>message.type==='user').slice(-20).map(message=>message.text):[],
    confirm:async revisionId=>{
      if(contextBusy||run?.id!==displayedRun||lastState?.state?.planningContext?.pending?.id!==revisionId)return;
      contextBusy=true;
      const button=$('planning-context')?.querySelector('button:last-child');
      if(button)button.disabled=true;
      try{
        await api('context/confirm',{runId:displayedRun,revisionId});
        showNotice(t('inputsConfirmed'));
      }catch(error){
        if(error.unconfirmed)contextUnconfirmed=revisionId;
        showNotice(error.message);
      }finally{
        contextBusy=false;
        try{await refresh();}catch{}
      }
    },
    read:async path=>({result:await api('file?path='+encodeURIComponent(path))}),
  });
  renderMessages(chat.messages);renderQuestion(chat.question,state);renderCalendar(state,visibleOptions(chat.question,state));renderProposal(state);
  if(chat.error)showNotice(chat.error);
}
$('language').onchange=()=>{labels();action(refresh);};
$('refresh').onclick=()=>action(refresh,t('refreshed'));
$('start').onclick=()=>action(async()=>{await api('run/start',{student:$('student').value});await refresh();},t('started'));
$('retire').onclick=()=>{if(!run||retirePending)return;retireReview={id:run.id,student:run.student};renderRetireReview()?.focus();};
$('chat').onsubmit=event=>{event.preventDefault();const text=$('text').value;action(async()=>{await api('chat/send',{text});$('text').value='';await refresh();},t('sent'));};
labels();await action(refresh);let polling=false;setInterval(async()=>{if(polling)return;polling=true;try{await refresh();}catch(error){showNotice(error.message);}finally{polling=false;}},2000);
