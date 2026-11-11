import {constants,promises as fs} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

// A separate SQLite write transaction holds an OS-managed lock for the
// controller process lifetime. It does not prove that agent containers or
// earlier calendar writes have stopped; the lifecycle must verify those too.
export async function acquireControllerLease({directory}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('An absolute controller directory is required');
  await fs.mkdir(directory,{recursive:true,mode:0o700});const dir=await fs.lstat(directory);
  if(!dir.isDirectory()||(dir.mode&0o077)!==0||(process.getuid&&dir.uid!==process.getuid()))throw new Error('Controller directory must be private');
  const file=path.join(directory,'controller-lock.sqlite');let created;
  try{created=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){if(error.code!=='EEXIST')throw error;}
  await created?.close();
  const info=await fs.lstat(file);
  if(!info.isFile()||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))throw new Error('Controller lock file must be private');
  const db=new DatabaseSync(file);let held=false;
  try {db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');held=true;}
  catch(error){db.close();if(/locked|busy/i.test(String(error?.message)))throw new Error('A synthetic lifecycle controller is already active');throw error;}
  return {
    assertHeld(){if(!held)throw new Error('Controller lease is not held');},
    async release(){if(!held)return;held=false;try{db.exec('ROLLBACK');}finally{db.close();}}
  };
}
