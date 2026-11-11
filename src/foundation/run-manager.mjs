import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

// Trusted synthetic lifecycle registry. The driver owns actual resources; it
// must not put credentials in returned records or claim verification it cannot
// establish. This module is not an agent-facing service or a sandbox.
export async function createRunManager({root,driver}) {
  if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('An absolute synthetic lifecycle directory is required');
  for(const method of ['start','stopWriters','archive','stopSimulator','verifyRetired'])if(typeof driver?.[method]!=='function')throw new Error(`Missing lifecycle driver: ${method}`);
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const databasePath=path.join(root,'lifecycle.sqlite'),db=new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS active_run (slot INTEGER PRIMARY KEY CHECK(slot=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS completed_run (id TEXT PRIMARY KEY, body TEXT NOT NULL);');
    await fs.chmod(databasePath,0o600);
  } catch(error) {db.close();throw error;}
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  const read=()=>{const row=db.prepare('SELECT body FROM active_run WHERE slot=1').get();return row?JSON.parse(row.body):null;};
  const write=run=>db.prepare('UPDATE active_run SET body=? WHERE slot=1').run(JSON.stringify(run));
  const transition=(id,allowed,phase,details={})=>transaction(()=>{
    const run=read();if(!run||run.id!==id||!allowed.includes(run.phase))throw new Error('Active run changed or another lifecycle operation is in progress');
    Object.assign(run,details);run.phase=phase;run.updatedAt=new Date().toISOString();write(run);return run;
  });
  return {
    async current(){return read();},
    async completed(id){
      if(typeof id!=='string'||!id)throw new Error('Run ID is required');
      const record=db.prepare('SELECT body FROM completed_run WHERE id=?').get(id);
      return record?JSON.parse(record.body):null;
    },
    async start(student){
      if(!['ana','bruno'].includes(student))throw new Error('Unknown synthetic student');
      const id=randomUUID();
      const run={id,student,phase:'starting',createdAt:new Date().toISOString(),resources:{
        simulator:`study-calendar-${id}`,agent:`study-agent-${id}`,calendarNetwork:`study-calendar-net-${id}`,
        agentNetwork:`study-agent-net-${id}`
      }};
      transaction(()=>{if(read())throw new Error('An active or unresolved synthetic run already exists');db.prepare('INSERT INTO active_run(slot,body) VALUES(1,?)').run(JSON.stringify(run));});
      try {await driver.start(structuredClone(run));return transition(id,['starting'],'active');}
      catch(error){transition(id,['starting'],'start-failed');throw new Error('Synthetic run startup failed; inspect and retire its managed resources',{cause:error});}
    },
    async retire({force=false,discardUnsaved=false}={}){
      if(typeof force!=='boolean'||typeof discardUnsaved!=='boolean')throw new Error('Retirement decisions must be boolean');
      const initial=read();if(!initial)throw new Error('No active synthetic run');
      if(discardUnsaved&&initial.phase!=='archive-failed')throw new Error('Unsaved evidence can only be discarded after an archive failure');
      const run=transition(initial.id,['active','start-failed','archive-failed','retirement-failed'],'retiring',{forceRequested:!!initial.forceRequested||force,discardRequested:discardUnsaved});
      try {await driver.stopWriters(structuredClone(run),{force});}
      catch(error){transition(run.id,['retiring'],'retirement-failed');throw new Error('Could not verify writer retirement',{cause:error});}
      let archiveId=null,archiveSha256=null;
      if(!discardUnsaved){
        try {
          const archive=await driver.archive(structuredClone(run));
          if(archive?.archiveId!==run.id)throw new Error('Archive identity does not match the run');
          if(archive.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(archive.sha256))throw new Error('Archive hash is invalid');
          archiveId=archive.archiveId;
          archiveSha256=archive.sha256??null;
        } catch(error){transition(run.id,['retiring'],'archive-failed');throw new Error('Could not archive synthetic run evidence',{cause:error});}
      }
      try {
        await driver.stopSimulator(structuredClone(run));
        if(await driver.verifyRetired(structuredClone(run))!==true)throw new Error('Managed resources remain or could not be verified');
      } catch(error){transition(run.id,['retiring'],'retirement-failed');throw new Error('Synthetic run retirement could not be verified',{cause:error});}
      transaction(()=>{
        const current=read();if(!current||current.id!==run.id||current.phase!=='retiring')throw new Error('Active run changed before retirement');
        db.prepare('INSERT INTO completed_run(id,body) VALUES(?,?)').run(run.id,JSON.stringify({...current,phase:'retired',archiveId,archiveSha256,discarded:discardUnsaved,retiredAt:new Date().toISOString()}));
        db.prepare('DELETE FROM active_run WHERE slot=1').run();
      });
      return {id:run.id,archiveId,archiveSha256,discarded:discardUnsaved};
    },
    async close(){db.close();}
  };
}
