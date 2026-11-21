(()=>{
  const data=JSON.parse(document.getElementById('content').textContent);
  const $=id=>document.getElementById(id),make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const ui={en:{previous:'Previous',next:'Next',all:'Read all slides',single:'Slide view',notes:'More context and sources',minutes:'Suggested minutes',verified:'Verified',image:'Open full capture',download:'Download portable ZIP',guide:'Facilitator checklist',score:'Scorecard',position:'Slide',more:'More content below. Scroll to continue'},pt:{previous:'Anterior',next:'Próximo',all:'Ler todos os slides',single:'Modo slides',notes:'Mais contexto e fontes',minutes:'Minutos sugeridos',verified:'Verificado em',image:'Abrir captura completa',download:'Baixar ZIP portátil',guide:'Checklist do facilitador',score:'Ficha de avaliação',position:'Slide',more:'Mais conteúdo abaixo. Role para continuar'}};
  const params=new URLSearchParams(location.hash.slice(1));let language=params.get('lang')==='pt'?'pt':'en',index=Math.max(0,Math.min(data.slides.length-1,Number(params.get('slide')||1)-1)),all=false;
  if(!Number.isInteger(index))index=0;
  $('language').value=language;
  function link(href,label){const a=make('a',label);a.href=href;return a;}
  function slideView(slide,i){
    const text=slide[language],section=make('section');section.className='slide';section.id='slide-'+slide.id;section.setAttribute('aria-labelledby','title-'+slide.id);
    const top=make('div');top.className='slide-meta';top.append(make('span',`${i+1} / ${data.slides.length}`),make('span',`${ui[language].minutes}: ${slide.minutes}`));section.append(top);
    const heading=make('h1',text.title);heading.id='title-'+slide.id;section.append(heading,make('p',text.lead));
    const body=make('div');body.className=slide.image?'body with-image':'body';const copy=make('div');copy.className='copy';
    for(const [key,tag] of [['points','ul'],['steps','ol']])if(text[key]){const list=make(tag);for(const item of text[key])list.append(make('li',item));copy.append(list);}
    if(text.table){const table=make('table'),head=make('thead'),header=make('tr');for(const cell of text.table[0])header.append(make('th',cell));head.append(header);table.append(head);const tbody=make('tbody');for(const row of text.table.slice(1)){const tr=make('tr');for(const cell of row)tr.append(make('td',cell));tbody.append(tr);}table.append(tbody);copy.append(table);}
    if(text.code){const code=make('pre',text.code);copy.append(code);}
    if(slide.links){const nav=make('p');nav.className='references';for(const item of slide.links)nav.append(link(item.href==='cold-review/index.html'?item.href+'#lang='+language:item.href,item.label[language]),document.createTextNode(' '));copy.append(nav);}
    body.append(copy);
    if(slide.image){const figure=make('figure'),a=link(slide.image.path,''),img=make('img');img.src=slide.image.path;img.alt=slide.image.alt[language];img.loading=all?'lazy':'eager';img.onload=()=>requestAnimationFrame(updateScrollHint);a.append(img);figure.append(a,make('figcaption',ui[language].image));body.append(figure);}
    section.append(body);
    const notes=make('details');notes.append(make('summary',ui[language].notes),make('p',text.notes));if(slide.sources){const sourceList=make('ul');for(const source of slide.sources){const li=make('li');li.append(link(source.href,source.label));sourceList.append(li);}notes.append(sourceList);}section.append(notes);return section;
  }
  function updateScrollHint(){const body=$('slides').querySelector('.body');$('more').hidden=all||!body||body.getBoundingClientRect().bottom<=window.innerHeight-12;}
  function render(){
    const t=ui[language];document.documentElement.lang=language==='pt'?'pt-BR':'en';document.title=language==='pt'?'Study Atlas: apresentação do projeto':'Study Atlas: project onboarding';
    $('previous').textContent=t.previous;$('next').textContent=t.next;$('view').textContent=all?t.single:t.all;$('position').textContent=`${t.position} ${index+1} / ${data.slides.length}`;
    $('previous').disabled=index===0;$('next').disabled=index===data.slides.length-1;
    $('more').textContent=t.more;$('guide').textContent=t.guide;$('score').textContent=t.score;
    $('verified').textContent=`${t.verified}: ${data.verifiedOn} · ${data.slides.reduce((sum,s)=>sum+s.minutes,0)} min`;
    const select=$('topics');select.replaceChildren();data.slides.forEach((slide,i)=>{const option=make('option',`${i+1}. ${slide[language].title}`);option.value=String(i);option.selected=i===index;select.append(option);});
    $('slides').replaceChildren(...(all?data.slides.map(slideView):[slideView(data.slides[index],index)]));
    requestAnimationFrame(updateScrollHint);
    try{history.replaceState(null,'',`#slide=${index+1}&lang=${language}`);}catch{}
  }
  function move(delta){index=Math.max(0,Math.min(data.slides.length-1,index+delta));all=false;render();window.scrollTo({top:0});}
  $('more').onclick=()=>window.scrollBy({top:Math.round(window.innerHeight*.6),behavior:'smooth'});window.addEventListener('scroll',updateScrollHint,{passive:true});window.addEventListener('resize',updateScrollHint);
  $('previous').onclick=()=>move(-1);$('next').onclick=()=>move(1);$('language').onchange=()=>{language=$('language').value;render();};$('topics').onchange=()=>{index=Number($('topics').value);all=false;render();};$('view').onclick=()=>{all=!all;render();};
  document.addEventListener('keydown',event=>{if(['SELECT','INPUT','TEXTAREA'].includes(event.target.tagName)||event.altKey||event.ctrlKey||event.metaKey)return;if(event.key==='ArrowRight'){event.preventDefault();move(1);}if(event.key==='ArrowLeft'){event.preventDefault();move(-1);}});render();
})();
