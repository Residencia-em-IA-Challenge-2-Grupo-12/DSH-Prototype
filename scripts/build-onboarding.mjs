#!/usr/bin/env node
// Curated documentation/evidence packaging only. Never reads a credential profile or runtime trace.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
import vm from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),src=path.join(root,'docs/onboarding/presentation');
const destination=path.join(root,'.runtime/onboarding-package'),zipPath=path.join(root,'.runtime/study-atlas-onboarding.zip');
const read=relative=>readFile(path.join(root,relative),'utf8'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const content=JSON.parse(await read('docs/onboarding/presentation/content.json'));
const shape=value=>Array.isArray(value)?value.map(shape):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,shape(value[k])])):typeof value;
if(content.schemaVersion!==1||!/^\d{4}-\d{2}-\d{2}$/.test(content.verifiedOn))throw Error('Invalid presentation version/date');
const ids=new Set();for(const slide of content.slides){
  if(ids.has(slide.id)||!slide.id||!Number.isFinite(slide.minutes)||slide.minutes<=0)throw Error('Invalid slide identity/timing');ids.add(slide.id);
  if(JSON.stringify(shape(slide.en))!==JSON.stringify(shape(slide.pt)))throw Error('Language structure differs for '+slide.id);
  if(!slide.en.title||!slide.pt.title||!slide.en.notes||!slide.pt.notes)throw Error('Missing title/notes');
}
const minutes=content.slides.reduce((n,s)=>n+s.minutes,0);if(minutes<20||minutes>30)throw Error('Briefing timing outside agreed range');
const files=new Map(),textFiles=new Map();
function add(relative,bytes){if(relative.startsWith('/')||relative.split('/').some(p=>p==='..'||!p))throw Error('Unsafe package path');files.set(relative,Buffer.from(bytes));}
function text(relative,value){textFiles.set(relative,value);add(relative,value);}
const mappedDocs=new Map([
 ['docs/onboarding/facilitator-checklist.md','facilitator-checklist.md'],['docs/onboarding/bruno-persona.md','bruno-persona.md'],['docs/onboarding/scorecard.md','scorecard.md'],['docs/onboarding/schedule-review-decisions.md','references/schedule-review-decisions.md'],
 ['docs/evidence/consolidation-2026-11-17/retained-experiments.json','references/retained-experiments.json'],['docs/evidence/consolidation-2026-11-17/pr-heads.json','references/pr-heads.json'],['docs/evidence/consolidation-2026-11-17/original-acceptance.json','references/original-acceptance.json'],
 ['docs/host-luna-preview.md','references/host-luna-preview.md'],['docs/question-widget-contract.md','references/question-widget-contract.md'],['docs/pr-consolidation-proposal.md','references/pr-consolidation-proposal.md'],
 ['docs/review/luna-browser-walkthrough-2026-11-17.md','references/luna-browser-walkthrough-2026-11-17.md'],['docs/review/onboarding-readiness-2026-11-17.md','references/readiness.md'],['.github/CONTRIBUTING.md','references/contributing.md']
]);
for(const [source,dest] of mappedDocs)if(source.endsWith('.json'))add(dest,await readFile(path.join(root,source)));
const evidenceNames=['replay.html','summary.json','conversation-and-plans.json','report.md','question.jpg','first-proposal.jpg','corrected-proposal.jpg','applied-en.jpg','applied-pt.jpg','applied-pt-before-label-fix.jpg','label-before.txt','offline-after.txt'];
for(const name of evidenceNames){const repo='docs/evidence/luna-browser-2026-11-17/'+name,dest='evidence/'+name;mappedDocs.set(repo,dest);add(dest,await readFile(path.join(root,repo)));}
for(const slide of content.slides)if(slide.image){slide.image.path='assets/'+slide.image.file;add(slide.image.path,await readFile(path.join(root,slide.image.source)));delete slide.image.source;}
for(const name of ['summary.json','confirmation-pt.jpg','archived-pt.jpg']){const repo='docs/evidence/archive-ui-2026-11-17/'+name,dest='archive-evidence/'+name;mappedDocs.set(repo,dest);add(dest,await readFile(path.join(root,repo)));}
function mapLink(href,sourceFile,destFile){
  if(/^(https?:|mailto:|#)/.test(href))return href;
  const [target,fragment]=href.split('#');const repo=path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile),target));
  const mapped=mappedDocs.get(repo);if(mapped)return path.posix.relative(path.posix.dirname(destFile),mapped)+(fragment?'#'+fragment:'');
  // Optional deeper source references stay explicit online links, not broken local paths.
  return 'https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/blob/'+content.archiveUIHead+'/'+repo+(fragment?'#'+fragment:'');
}
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function inline(s){return escape(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,label,href)=>'<a href="'+href+'">'+label+'</a>');}
function markdown(s){
  const lines=s.split('\n'),out=[];let code=false,list=false;
  const close=()=>{if(list){out.push('</ul>');list=false;}};
  for(let i=0;i<lines.length;i++){
    const line=lines[i];if(line.startsWith('```')){close();out.push(code?'</code></pre>':'<pre><code>');code=!code;continue;}
    if(code){out.push(escape(line));continue;}
    if(/^\|/.test(line)&&i+1<lines.length&&/^\|[\s:|\-]+$/.test(lines[i+1])){
      close();const cells=l=>l.split('|').slice(1,-1).map(c=>c.trim());out.push('<div class="table-scroll" role="region" aria-label="Scrollable table / Tabela rolável" tabindex="0"><p class="table-hint">Scroll horizontally / Role horizontalmente</p><table><thead><tr>'+cells(line).map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>');i+=2;
      while(i<lines.length&&lines[i].startsWith('|')){out.push('<tr>'+cells(lines[i]).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>');i++;}i--;out.push('</tbody></table></div>');continue;
    }
    const h=line.match(/^(#{1,6})\s+(.*)/);if(h){close();const n=Math.min(3,h[1].length);out.push(`<h${n}>${inline(h[2])}</h${n}>`);continue;}
    const li=line.match(/^(?:-\s+|\d+\.\s+)(.*)/);if(li){if(!list){out.push('<ul>');list=true;}out.push('<li>'+inline(li[1]).replace(/^\[ \]/,'<input type="checkbox" aria-label="Checklist item">')+'</li>');continue;}
    close();if(line.trim())out.push('<p>'+inline(line)+'</p>');
  }close();if(code)throw Error('Unclosed Markdown fence');return out.join('\n');
}
const style=await read('docs/onboarding/presentation/style.css'),app=await read('docs/onboarding/presentation/app.js'),template=await read('docs/onboarding/presentation/template.html');new vm.Script(app);
for(const [source,dest] of mappedDocs){if(!source.endsWith('.md')||!source.startsWith('docs/')&&source!=='.github/CONTRIBUTING.md')continue;
  let md=await read(source);md=md.replace(/\]\(([^)]+)\)/g,(_,href)=>']('+mapLink(href,source,dest)+')');text(dest,md);
  if(['facilitator-checklist.md','bruno-persona.md','scorecard.md'].includes(dest))text(dest.replace('.md','.html'),`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(dest)}</title><style>${style}</style><body><main class="doc"><a href="index.html">Presentation / Apresentação</a>${markdown(md).replace(/href="(bruno-persona|scorecard|facilitator-checklist)\.md"/g,'href="$1.html"')}<p><a href="${dest}">Editable Markdown / Markdown editável</a></p></main></body></html>`);
}
let html=template.replace('__STYLE__',style).replace('__CONTENT__',JSON.stringify(content).replaceAll('<','\\u003c')).replace('__APP__',app);text('index.html',html);text('content.json',JSON.stringify(content,null,2)+'\n');
text('README.md',`# Study Atlas onboarding / Apresentação\n\nVerified / Verificado: ${content.verifiedOn}.\n\nOpen index.html in a browser. No server or network is needed for slides, notes, actual screenshot replay or included documents. GitHub references and the live application require their respective environment/network.\n\nAbra index.html em um navegador. Slides, notas, replay e documentos incluídos funcionam offline. Referências GitHub e a aplicação ao vivo exigem os respectivos ambientes/rede.\n\n${content.slides.length} slides, ${minutes} suggested briefing minutes including replay. Hands-on is separate. The package contains documentation and synthetic evidence, not the application, Docker images, credentials or private runtime archives.\n\n${content.slides.length} slides, ${minutes} minutos sugeridos com replay. Prática separada. O pacote contém documentos/evidências sintéticas, não a aplicação, imagens Docker, credenciais ou arquivos privados.\n\nEdit presentation/content.json and presentation/app.js/style.css in the repository, then run node scripts/build-onboarding.mjs with installed project dependencies. A maintainer verifies current code/issues before updating verifiedOn.\n`);
// Check all generated local links/images, including embedded slide data, before writing anything.
for(const slide of content.slides)for(const link of slide.links||[])if(!/^https?:/.test(link.href)&&!files.has(link.href))throw Error('Missing slide link '+link.href);
for(const [name,body] of textFiles){for(const match of body.matchAll(name.endsWith('.html')?/(?:href|src)="([^"]+)"/g:/\]\(([^)]+)\)/g)){
  const target=match[1];if(/^(https?:|mailto:|#|data:)/.test(target))continue;const relative=path.posix.normalize(path.posix.join(path.posix.dirname(name),target.split('#')[0]));if(!files.has(relative))throw Error(`Missing local reference ${name}: ${target}`);
}}
const manifest={schemaVersion:1,verifiedOn:content.verifiedOn,slideCount:content.slides.length,suggestedMinutes:minutes,applicationEvidenceHead:content.applicationEvidenceHead,archiveUIHead:content.archiveUIHead,files:[...files].map(([name,bytes])=>({name,bytes:bytes.length,sha256:sha(bytes)}))};text('manifest.json',JSON.stringify(manifest,null,2)+'\n');
await mkdir(destination,{recursive:true});for(const [name,bytes] of files){const target=path.join(destination,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
const zipBytes=zipSync(Object.fromEntries([...files].map(([name,bytes])=>['study-atlas-onboarding/'+name,[bytes,{mtime:new Date(content.verifiedOn+'T12:00:00Z')}]])),{level:6});const restored=unzipSync(zipBytes);for(const [name,bytes] of files)if(sha(restored['study-atlas-onboarding/'+name])!==sha(bytes))throw Error('ZIP round-trip mismatch: '+name);await writeFile(zipPath,zipBytes);
console.log(JSON.stringify({directory:destination,zip:zipPath,zipBytes:zipBytes.length,files:files.size,slides:content.slides.length,suggestedMinutes:minutes,localLinks:'verified',languageStructure:'parity verified',zipRoundTrip:'all hashes match'},null,2));
