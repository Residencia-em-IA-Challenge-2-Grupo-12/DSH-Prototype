// Small safe formatting subset for model prose. All text is inserted through
// DOM text nodes; raw HTML, images and arbitrary link schemes are unsupported.
export function appendMessageText(root,text){
  const document=root.ownerDocument;
  function inline(parent,value){
    const pattern=/\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;let position=0;
    for(const match of value.matchAll(pattern)){
      parent.append(document.createTextNode(value.slice(position,match.index)));
      const tag=match[1]?'strong':match[2]?'code':'a',part=document.createElement(tag);part.textContent=match[1]||match[2]||match[3];
      if(tag==='a'){part.href=match[4];part.target='_blank';part.rel='noopener noreferrer';}
      parent.append(part);position=match.index+match[0].length;
    }
    parent.append(document.createTextNode(value.slice(position)));
  }
  let list=null,paragraph=null;
  for(const line of String(text||'').split('\n')){
    if(!line.trim()){list=null;paragraph=null;continue;}
    const heading=/^(#{1,4})\s+(.+)$/.exec(line),bullet=/^\s*(?:([-*])|\d+[.)])\s+(.+)$/.exec(line);
    if(heading){list=null;paragraph=null;const h=document.createElement(heading[1].length<3?'h3':'h4');inline(h,heading[2]);root.append(h);}
    else if(bullet){paragraph=null;const tag=bullet[1]?'ul':'ol';if(list?.tagName.toLowerCase()!==tag){list=document.createElement(tag);root.append(list);}const li=document.createElement('li');inline(li,bullet[2]);list.append(li);}
    else{list=null;if(!paragraph){paragraph=document.createElement('p');root.append(paragraph);}else paragraph.append(document.createElement('br'));inline(paragraph,line);}
  }
}

export function renderConversation(root,messages,language='en'){
  const document=root.ownerDocument,pt=language==='pt';
  const out=[],activity=[];
  for(const message of messages){
    if(message.type==='activity'){activity.push(message.text);continue;}
    const article=document.createElement('article');article.className=message.type==='user'?'user':'assistant';
    const author=document.createElement('small');author.textContent=message.type==='user'?(pt?'Você':'You'):'Luna';article.append(author);
    appendMessageText(article,message.text);out.push(article);
  }
  if(activity.length){
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=pt?`Atividade das ferramentas (${activity.length})`:`Tool activity (${activity.length})`;details.append(summary);
    for(const item of activity){const line=document.createElement('p');line.textContent=item;details.append(line);}out.push(details);
  }
  root.replaceChildren(...out);
}
