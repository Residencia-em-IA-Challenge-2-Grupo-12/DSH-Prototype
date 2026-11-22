import {browser} from './browser.mjs';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const fixtureScript=fileURLToPath(new URL('fixture.mjs',import.meta.url));
const [out]=process.argv.slice(2);
if(!out)throw Error('Provide a new artifact directory for the scripted review');
await mkdir(out,{recursive:true});
const startPort=Number(process.env.STUDY_BROWSER_TEST_PORT||4190);
if(!Number.isInteger(startPort)||startPort<1024||startPort>65534)throw Error('Invalid browser review test port');
const controlDir=await mkdtemp('/tmp/study-fixture-controls-');
const result={scripted:true,cases:{}};
for(const [student,port] of [['bruno',startPort],['ana',startPort+1]]){
  const control=`${controlDir}/${student}`;
  const fixture=spawn(process.execPath,[fixtureScript,repo,student,port,control],{stdio:['ignore','pipe','inherit']});
  try{
    await new Promise((resolve,reject)=>{fixture.stdout.once('data',resolve);fixture.once('error',reject);fixture.once('exit',code=>reject(Error('Fixture exited '+code)));});
    await browser(`http://127.0.0.1:${port}/`,async({wait,fill,click,evaluate,capture,call})=>{
      const shot=name=>capture(out+'/'+name+'.png');
      const send=async text=>{await fill('#text',text);await click('#send');await wait("document.querySelector('#text').value === ''");};
      await wait("!document.querySelector('#start').disabled");await click('#start');
      await wait("!document.querySelector('#send').disabled");await send('Start exercise');
      await wait("document.querySelector('#question form')");
      const ev={};
      if(student==='bruno'){
        await wait("document.querySelector('.calendar-event.conflict') && document.querySelector('.calendar-event.candidate')");
        assert.equal(await evaluate("document.querySelector('#question input[value=\"Tuesday morning\"]').disabled"),true);
        await click('#nav-calendar');
        await shot('scripted-busy-option');
        await click('#question input[value="Wednesday evening"]');
        await writeFile(control,'add');
        await click('#question button[type=submit]');
        await wait("document.querySelector('#notice').innerText.includes('now overlaps')");
        assert.equal(await evaluate("document.querySelector('#question input[value=\"Wednesday evening\"]').disabled"),true);
        await shot('scripted-late-conflict');
        await writeFile(control,'clear');
        await fill('#question textarea','Keep Monday free. Wednesday, Saturday and Sunday work this week.');
        await click('#question button[type=submit]');
        await wait("document.querySelector('#planning-context > button:not(:disabled)')");
        await send('Remove Monday');
        await wait("document.querySelector('.context-changes').innerText.includes('Removed · Monday')");
        await click('#nav-context');
        await shot('scripted-monday-diff');
        ev.initialOptionBlocked=true;ev.lateConflictRejected=true;ev.mondayDiff=true;
      }else{
        await click('#question input[value="Noon (LMS)"]');
        await click('#question button[type=submit]');
        await wait("document.querySelector('#planning-context > button:not(:disabled)')");
        await click('.context-course summary');
        await click('.context-course button');
        await wait("document.querySelector('.context-course pre').innerText.includes('closes at 12:00')");
        ev.sourceOpened=true;
      }
      await wait("document.querySelector('#planning-context > button:not(:disabled)')");
      assert.equal(await evaluate("document.querySelectorAll('#proposal button').length"),0);
      await click('#planning-context > button');
      await wait("document.querySelector('#planning-context').innerText.includes('Confirmed inputs')");
      await send('Draft the week');
      await wait("document.querySelector('#proposal .course-coverage')");
      ev.coverage=await evaluate("document.querySelector('#proposal .course-coverage').innerText");
      if(student==='ana'){
        assert.match(ev.coverage,/Statistics · 0 h/);
        await click('#nav-review');
        await shot('scripted-ana-coverage');
        await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await wait("document.documentElement.scrollWidth === 390");
        await shot('scripted-ana-mobile');
        await send('Show a course coverage alternative');
        await wait("document.querySelector('#proposal').innerText.includes('Course coverage alternative')");
        ev.alternative=await evaluate("document.querySelector('#proposal .course-coverage').innerText");
        assert.match(ev.alternative,/Machine Learning · 3 h/);
        assert.match(ev.alternative,/Statistics · 1 h/);
        await click('#nav-review');
        await shot('scripted-ana-coverage-alternative');
      }else{
        await wait("document.querySelector('.calendar-event.proposed')");
        await click('#proposal .proposal-section:first-of-type details summary');
        assert.match(await evaluate("document.querySelector('#proposal .proposal-section:first-of-type details').innerText"),/19:00–20:00/);
        // A fresh provider change after the plan is reviewed must fence writes.
        const status=()=>evaluate("fetch('/api/status?runId=scripted-bruno').then(response=>response.json())");
        const initial=await status();
        await writeFile(control,'add');
        await click('#proposal button:first-of-type');
        await wait("document.querySelector('#notice').innerText.includes('STALE')");
        ev.staleApprovalRejected=true;
        await writeFile(control,'clear');
        await send('Draft the week');
        await wait(`fetch('/api/status?runId=scripted-bruno').then(response=>response.json()).then(body=>body.state.plan?.id !== ${JSON.stringify(initial.state.plan.id)})`);
        await wait("document.querySelector('#proposal .proposal-section:first-of-type button:not(:disabled)')");
        const reviewed=await status();
        assert.notEqual(reviewed.state.plan.id,initial.state.plan.id);
        assert.deepEqual(reviewed.events,initial.events);
        assert.ok(reviewed.state.plan.future.length,'The future approval must have separate proposed events');
        await writeFile(control,'allow-writes');
        await click('#proposal .proposal-section:first-of-type button');
        await wait("document.querySelector('#proposal .proposal-section:first-of-type h3').textContent.includes('applied')");
        const after=await status();
        assert.deepEqual(after.events.slice(0,initial.events.length),initial.events);
        assert.deepEqual(after.events.slice(initial.events.length).map(event=>event.id).sort(),reviewed.state.plan.near.map(event=>event.id).sort());
        assert.equal(after.state.plan.status.future,'pending');
        ev.nearOnlyApplied=true;
        await shot('scripted-near-only-applied');
      }
      ev.unexpectedCalendarWrites=await readFile(control+'.unexpected','utf8').then(()=>true).catch(error=>{if(error.code==='ENOENT')return false;throw error;});
      assert.equal(ev.unexpectedCalendarWrites,false);
      result.cases[student]=ev;
    });
  }finally{
    fixture.kill();
  }
}
await rm(controlDir,{recursive:true});
await writeFile(out+'/scripted-result.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
