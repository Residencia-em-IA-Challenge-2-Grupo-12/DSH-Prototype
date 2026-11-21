import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';

export async function browser(url,task){
  const profile=await mkdtemp('/tmp/study-ui-chrome-');
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const chrome=spawn(process.env.STUDY_TEST_CHROME||'google-chrome',['--headless','--disable-gpu','--disable-background-networking','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,url],{stdio:['ignore','ignore','ignore']});
  let ws;
  try{
    let port,tabs;
    for(let i=0;i<100;i++){
      try{
        port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];
        tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        if(tabs.find(x=>x.type==='page'))break;
      }catch{}
      await delay(100);
    }
    ws=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let seq=0;
    const requests=new Map();
    ws.onmessage=({data})=>{
      const row=JSON.parse(data),request=requests.get(row.id);
      if(!request)return;
      requests.delete(row.id);
      row.error?request.reject(Error(JSON.stringify(row.error))):request.resolve(row.result);
    };
    const call=(method,params={})=>new Promise((resolve,reject)=>{let id=++seq;requests.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{
      const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:980,deviceScaleFactor:1,mobile:false});
    async function wait(expression,timeout=15000){
      let end=Date.now()+timeout;
      while(Date.now()<end){try{const result=await evaluate(expression);if(result)return result;}catch{}await delay(250);}
      throw Error('Timed out: '+expression+' · '+(await evaluate("document.body.innerText.slice(-1000)")));
    }
    async function click(selector){
      const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||!e.getClientRects().length)throw Error('Unavailable control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',...point,clickCount:1});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',...point,clickCount:1});
    }
    async function fill(selector,text){
      await click(selector);
      await call('Input.insertText',{text});
    }
    async function capture(filename) {
      const {data}=await call('Page.captureScreenshot',{format:'png'});
      await writeFile(filename,Buffer.from(data,'base64'));
    }
    await task({call,evaluate,wait,click,fill,capture,url});
  }finally{
    ws?.close();
    chrome.kill();
    await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),delay(2500)]);
    await rm(profile,{recursive:true,force:true,maxRetries:6,retryDelay:100});
  }
}
