import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {ROOT,readJSON,resetScenario,draft,applyApproved} from '../src/core.mjs';

test('status remains readable with an unresolved claim when the calendar is unavailable', {timeout:10000}, async()=>{
  const calendar={
    async reset(student){this.items=structuredClone((await readJSON(`${ROOT}/fixtures/calendars/${student}.json`)).events);},
    async events(){return structuredClone(this.items);},
    async create(){throw new Error('synthetic provider response lost');},
    async remove(_student,id){this.items=this.items.filter(event=>event.id!==id);}
  };
  await resetScenario(calendar,'ana');
  const proposal=await draft(calendar,'ana',{weeks:1,hours:1});
  await assert.rejects(()=>applyApproved(calendar,'ana',proposal.id,'near'),/PARTIAL/);
  const reservation=createServer();
  await new Promise((resolve,reject)=>reservation.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[`${ROOT}/src/server.mjs`],{
    env:{...process.env,PORT:String(port),CALENDARPIT_URL:'http://127.0.0.1:1'},stdio:'ignore'
  });
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>resolve());});
  try {
    let response;const deadline=Date.now()+5000;
    while(Date.now()<deadline&&!response){try{response=await fetch(`http://127.0.0.1:${port}/api/status?student=ana`);}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
    assert(response,'server did not start');
    assert.equal(response.status,200);
    const status=await response.json();
    assert.equal(status.calendar.availability,'unavailable');
    assert.equal(status.events,null,'unavailable observations must not look like an empty calendar');
    assert.equal(status.state.plan.id,proposal.id);
    assert.equal(status.state.plan.status.near,'partial');
    assert.equal(status.recovery.kind,'approval');
    assert.equal(status.recovery.proposalId,proposal.id);
    assert(status.recovery.steps.some(step=>step.status==='sent'));
    const other=await fetch(`http://127.0.0.1:${port}/api/status?student=bruno`).then(result=>result.json());
    assert.equal(other.state,null);
    assert.equal(other.calendar.availability,'unavailable');
    assert.equal(other.recovery.id,status.recovery.id,'a shared simulator claim must remain visible across personas');
  } finally {child.kill('SIGTERM');await exited.catch(()=>{});}
});

test('status distinguishes a missing synthetic calendar from an offline simulator', {timeout:10000}, async()=>{
  const provider=createHttpServer((_request,response)=>{response.writeHead(404);response.end('missing synthetic calendar');});
  await new Promise((resolve,reject)=>provider.once('error',reject).listen(0,'127.0.0.1',resolve));
  const providerPort=provider.address().port;
  const reservation=createServer();
  await new Promise((resolve,reject)=>reservation.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[`${ROOT}/src/server.mjs`],{
    env:{...process.env,PORT:String(port),CALENDARPIT_URL:`http://127.0.0.1:${providerPort}`},stdio:'ignore'
  });
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>resolve());});
  try {
    let response;const deadline=Date.now()+5000;
    while(Date.now()<deadline&&!response){try{response=await fetch(`http://127.0.0.1:${port}/api/status?student=ana`);}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
    assert(response,'server did not start');assert.equal(response.status,200);
    const status=await response.json();
    assert.equal(status.calendar.availability,'not_found');
    assert.equal(status.events,null);assert.equal(status.state,null);assert.equal(status.recovery,null);
  } finally {child.kill('SIGTERM');await exited.catch(()=>{});await new Promise(resolve=>provider.close(resolve));}
});
