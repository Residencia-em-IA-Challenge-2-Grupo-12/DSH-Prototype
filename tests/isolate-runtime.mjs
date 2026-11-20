// Top-level tests in this suite run sequentially. Each receives a disposable
// synthetic runtime, inherited by any subprocess that tests coordination.
import {beforeEach,afterEach} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

let directory;
const previous=process.env.STUDY_ATLAS_RUNTIME_DIR;
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'study-atlas-test-'));
  process.env.STUDY_ATLAS_RUNTIME_DIR=directory;
});
afterEach(async()=>{
  if(previous===undefined)delete process.env.STUDY_ATLAS_RUNTIME_DIR;
  else process.env.STUDY_ATLAS_RUNTIME_DIR=previous;
  await rm(directory,{recursive:true,force:true});
});
