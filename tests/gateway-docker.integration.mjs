import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

test('a synthetic gateway secret and its budget survive container recreation', {skip:process.env.STUDY_DOCKER_TEST!=='1',timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'study-gateway-docker-'));
  const envFile=join(directory,'openrouter.env');
  await writeFile(envFile,'OPENROUTER_API_KEY=synthetic-example-only\n',{mode:0o600});
  const env={...process.env,STUDY_OPENROUTER_ENV_FILE:envFile,COMPOSE_PROJECT_NAME:`study-gateway-test-${randomBytes(5).toString('hex')}`};
  const compose=(...args)=>{
    const result=spawnSync('docker',['compose','--profile','model-gateway',...args],{env,encoding:'utf8',timeout:90000});
    assert.equal(result.status,0,`docker compose ${args[0]} failed: ${result.stderr}`);
    return result.stdout;
  };
  try {
    compose('up','-d','--build','model-gateway');
    compose('exec','-T','model-gateway','node','--input-type=module','-e',
      "import {readFile} from 'node:fs/promises'; import {parseEnv} from 'node:util'; if(parseEnv(await readFile('/run/secrets/openrouter_env','utf8')).OPENROUTER_API_KEY!=='synthetic-example-only') process.exit(1); const {createModelBudget}=await import('./src/foundation/model-budget.mjs'); const b=await createModelBudget({directory:'/var/lib/study-model-budget'}); const r=await b.reserve({role:'setup',estimatedUsd:0.02}); await b.settle(r.id,{actualUsd:0.01}); await b.close();");
    compose('down');
    compose('up','-d','model-gateway');
    compose('exec','-T','model-gateway','node','--input-type=module','-e',
      "import {readFile} from 'node:fs/promises'; import {parseEnv} from 'node:util'; if(parseEnv(await readFile('/run/secrets/openrouter_env','utf8')).OPENROUTER_API_KEY!=='synthetic-example-only') process.exit(1); const {createModelBudget}=await import('./src/foundation/model-budget.mjs'); const b=await createModelBudget({directory:'/var/lib/study-model-budget'}); if((await b.summary()).observedUsd!==0.01) process.exit(1); await b.close();");
  } finally {
    try {compose('down','--volumes','--remove-orphans');} finally {await rm(directory,{recursive:true,force:true});}
  }
});
