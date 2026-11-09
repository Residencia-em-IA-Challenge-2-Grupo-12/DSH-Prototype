// Synthetic baseline state store. This module is not an authentication or
// agent-isolation boundary; callers must use the same local database.
import {promises as fs} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

export function createStateStore(directory) {
  let opening;
  const database=()=>opening??=(async()=>{
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const db=new DatabaseSync(path.join(directory,'state.sqlite'));
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS student_state (student TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS calendar_claim (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS calendar_claim_history (id TEXT PRIMARY KEY, body TEXT NOT NULL);');
      await fs.chmod(path.join(directory,'state.sqlite'),0o600);
      return db;
    } catch(error) {db.close();throw error;}
  })().catch(error=>{opening=undefined;throw error;});
  const transaction=(db,fn)=>{
    db.exec('BEGIN IMMEDIATE');
    try {const value=fn();db.exec('COMMIT');return value;}
    catch(error) {db.exec('ROLLBACK');throw error;}
  };
  const row=(db,student)=>db.prepare('SELECT body FROM student_state WHERE student=?').get(student);
  const assertIdle=db=>{if(db.prepare('SELECT 1 FROM calendar_claim WHERE singleton=1').get())throw new Error('A calendar operation is unresolved');};
  const applyChange=(state,change)=>{const result=change?.(state);if(result&&typeof result.then==='function')throw new Error('State transaction must not await');return result;};
  const writeState=(db,student,state)=>db.prepare('INSERT INTO student_state (student,body) VALUES (?,?) ON CONFLICT(student) DO UPDATE SET body=excluded.body').run(student,JSON.stringify(state));
  async function load(student) {
    const db=await database();let found=row(db,student);
    if(!found) {
      // Import the existing synthetic JSON once; retain it unchanged as a backup.
      const legacy=await fs.readFile(path.join(directory,student+'.json'),'utf8');
      const parsed=JSON.parse(legacy);
      transaction(db,()=>db.prepare('INSERT OR IGNORE INTO student_state (student,body) VALUES (?,?)').run(student,JSON.stringify(parsed)));
      found=row(db,student);
    }
    return JSON.parse(found.body);
  }
  async function save(student,state) {
    const db=await database();const body=JSON.stringify(state);
    transaction(db,()=>{assertIdle(db);db.prepare('INSERT INTO student_state (student,body) VALUES (?,?) ON CONFLICT(student) DO UPDATE SET body=excluded.body').run(student,body);});
  }
  async function update(student,change,{requiresIdle=false}={}) {
    await load(student); // Also imports a legacy synthetic state if needed.
    const db=await database();
    return transaction(db,()=>{
      if(requiresIdle)assertIdle(db);
      const active=db.prepare('SELECT body FROM calendar_claim WHERE singleton=1').get();
      if(active&&JSON.parse(active.body).kind==='reset')throw new Error('A calendar reset is unresolved');
      const current=row(db,student);if(!current)throw new Error('Synthetic state is unavailable');
      const state=JSON.parse(current.body);const result=applyChange(state,change);
      db.prepare('UPDATE student_state SET body=? WHERE student=?').run(JSON.stringify(state),student);
      return result;
    });
  }
  // Claims do not expire automatically: a late provider operation can still
  // arrive after an elapsed timeout or a failed observation.
  async function getCalendarClaim() {
    const db=await database();
    const current=db.prepare('SELECT body FROM calendar_claim WHERE singleton=1').get();
    return current?JSON.parse(current.body):null;
  }
  async function acquireCalendarClaim(intent,{student,change}={}) {
    if(!intent || typeof intent.id!=='string' || !intent.id || typeof intent.student!=='string' || !Array.isArray(intent.actions))throw new Error('Invalid calendar claim');
    if(student&&student!==intent.student)throw new Error('Calendar claim student does not match');
    const actionIds=intent.actions.map(action=>action.actionId);
    if(actionIds.some(actionId=>typeof actionId!=='string'||!actionId)||new Set(actionIds).size!==actionIds.length)throw new Error('Invalid calendar claim actions');
    if(student)await load(student);
    const db=await database();
    return transaction(db,()=>{
      assertIdle(db);
      if(student){
        const current=row(db,student);if(!current)throw new Error('Synthetic state is unavailable');
        const state=JSON.parse(current.body);applyChange(state,change);writeState(db,student,state);
      }
      const claim={...intent,steps:[]};
      db.prepare('INSERT INTO calendar_claim(singleton,body) VALUES(1,?)').run(JSON.stringify(claim));
      return claim;
    });
  }
  async function appendCalendarClaimStep(id,step) {
    const db=await database();
    return transaction(db,()=>{
      const row=db.prepare('SELECT body FROM calendar_claim WHERE singleton=1').get();
      if(!row)throw new Error('Calendar claim not found');
      const claim=JSON.parse(row.body);
      if(claim.id!==id)throw new Error('Calendar claim does not match');
      if(!step || typeof step.actionId!=='string' || !['sent','acknowledged','confirmed','unknown'].includes(step.status))throw new Error('Invalid calendar claim step');
      if(!claim.actions.some(action=>action.actionId===step.actionId))throw new Error('Unknown calendar action');
      const previous=claim.steps.findLast(item=>item.actionId===step.actionId)?.status;
      const allowed=step.status==='sent'?!previous:step.status==='acknowledged'?previous==='sent':
        step.status==='confirmed'?previous==='acknowledged':previous==='sent'||previous==='acknowledged';
      if(!allowed)throw new Error('Invalid calendar action step order');
      claim.steps.push(step);
      db.prepare('UPDATE calendar_claim SET body=? WHERE singleton=1').run(JSON.stringify(claim));
      return claim;
    });
  }
  async function finishCalendarClaim(id,{student,change,replacement},cancel) {
    const db=await database();
    return transaction(db,()=>{
      const current=db.prepare('SELECT body FROM calendar_claim WHERE singleton=1').get();
      if(!current)throw new Error('Calendar claim not found');
      const claim=JSON.parse(current.body);
      if(claim.id!==id)throw new Error('Calendar claim does not match');
      if(cancel){
        if(claim.steps.some(step=>step.status==='sent'))throw new Error('Cannot cancel a sent calendar operation');
      } else {
        for(const action of claim.actions){
          const last=claim.steps.findLast(step=>step.actionId===action.actionId);
          if(!action.actionId||last?.status!=='confirmed')throw new Error('Calendar action is unconfirmed');
        }
      }
      if(student){
        const previous=row(db,student);
        const state=replacement??(previous?JSON.parse(previous.body):null);
        if(!state)throw new Error('Synthetic state is unavailable');
        applyChange(state,change);writeState(db,student,state);
      }
      db.prepare('INSERT INTO calendar_claim_history(id,body) VALUES(?,?)').run(id,JSON.stringify({...claim,disposition:cancel?'cancelled':'completed',finishedAt:new Date().toISOString()}));
      db.prepare('DELETE FROM calendar_claim WHERE singleton=1').run();
    });
  }
  return {load,save,update,getCalendarClaim,acquireCalendarClaim,appendCalendarClaimStep,
    completeCalendarClaim:(id,options={})=>finishCalendarClaim(id,options,false),
    cancelCalendarClaim:(id,options={})=>finishCalendarClaim(id,options,true)};
}
