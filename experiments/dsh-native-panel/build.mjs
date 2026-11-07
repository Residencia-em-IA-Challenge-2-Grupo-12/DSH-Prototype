import {spawnSync} from 'node:child_process';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const esbuild=process.env.ESBUILD_BIN||'esbuild';
const version=spawnSync(esbuild,['--version'],{encoding:'utf8'});
if(version.status!==0||version.stdout.trim()!=='0.25.5')throw Error('esbuild 0.25.5 is required; set ESBUILD_BIN to its executable');
const inner=path.join(here,'client-inner.cjs');
try {
 const built=spawnSync(esbuild,[path.join(here,'client-entry.mjs'),'--bundle','--platform=browser','--format=cjs','--external:react','--outfile='+inner],{encoding:'utf8'});
 if(built.status!==0)throw Error('esbuild failed: '+built.stderr);
 const source=await readFile(inner,'utf8');
 await writeFile(path.join(here,'client.js'),"window.__ModuleLoader__.load({id:'study-calendar-browser-spike',factory(require){const module={exports:{}};const exports=module.exports;\n"+source+"\nreturn module.exports;}});\n");
 console.log('Built synthetic panel bundle');
} finally {await rm(inner,{force:true});}
