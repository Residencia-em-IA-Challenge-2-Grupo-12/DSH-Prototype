import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,lstat,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureGatewayTokenFile} from '../src/foundation/gateway-token.mjs';

test('a private internal gateway token survives service recreation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-token-'));
  try {
    const first=await ensureGatewayTokenFile({directory:join(root,'control')});
    const second=await ensureGatewayTokenFile({directory:join(root,'control')});
    assert.match(first.accessToken,/^[a-f0-9]{64}$/);
    assert.equal(second.accessToken,first.accessToken);
    assert.equal((await lstat(first.file)).mode&0o777,0o600);
    assert.equal((await readFile(first.file,'utf8')).trim(),first.accessToken);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('unsafe or invalid existing token files are rejected without replacement',async()=>{
  const root=await mkdtemp(join(tmpdir(),'study-token-invalid-'));
  try {
    const file=join(root,'gateway-token');await writeFile(file,'bad-token',{mode:0o600});
    await assert.rejects(ensureGatewayTokenFile({directory:root}));
    assert.equal(await readFile(file,'utf8'),'bad-token');
    await rm(file);await writeFile(file,'a'.repeat(64),{mode:0o600});await chmod(file,0o644);
    await assert.rejects(ensureGatewayTokenFile({directory:root}));
    await rm(file);await symlink('/dev/null',file);
    await assert.rejects(ensureGatewayTokenFile({directory:root}));
    await assert.rejects(ensureGatewayTokenFile({directory:'relative'}));
  } finally {await rm(root,{recursive:true,force:true});}
});
