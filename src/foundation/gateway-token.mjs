import {randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {promises as fs} from 'node:fs';
import path from 'node:path';

// Trusted control state only: never put this credential in a run workspace,
// archive, command line, logs or browser. It is not the OpenRouter key.
export async function ensureGatewayTokenFile({directory}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('An absolute private control directory is required');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const dir=await fs.lstat(directory);
  if(!dir.isDirectory()||(dir.mode&0o077)!==0||(process.getuid&&dir.uid!==process.getuid()))throw new Error('Gateway control directory must be private and owned by the current user');
  const file=path.join(directory,'gateway-token');
  let created;
  try {created=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){if(error.code!=='EEXIST')throw error;}
  if(created){try{await created.writeFile(randomBytes(32).toString('hex')+'\n');await created.sync();}finally{await created.close();}}
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||(stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid()))throw new Error('Gateway token file must be private and owned by the current user');
    const accessToken=(await handle.readFile('utf8')).trim();
    if(!/^[a-f0-9]{64}$/.test(accessToken))throw new Error('Gateway token file is invalid');
    return {file,accessToken};
  } finally {await handle.close();}
}
