import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelHost} from './index.mjs';

const original={context:1,evidence:1,calendar:1};
const event={id:'study',summary:'Study',start:{dateTime:'2026-11-03T14:00:00-03:00'},end:{dateTime:'2026-11-03T15:00:00-03:00'}};
const record=(versions=original)=>({id:'fixture',student:'ana',versions:{...versions},payload:{sections:{near:{action:{type:'create',calendarId:'ana-calendar',event}}}}});
function setup({versions=original,latest={calendar:1,evidence:1,context:1},calendar,proposal}={}) {
  const values={versions,latest,calendar:calendar??{student:'ana',kind:'calendar',version:1,payload:{events:[]}},proposal:proposal??record()};let count=0;
  const fetchImpl=async url=>({ok:true,json:async()=>url.endsWith('/versions')?(count++?values.latest:values.versions):url.includes('/revisions/')?values.calendar:values.proposal});
  return {host:{origin:'http://127.0.0.1:12345',selected:'fixture',fetchImpl},values};
}
test('panel checks complete revision maps and record identities',async()=>{
  const cases=[{versions:{calendar:1}},{latest:{calendar:1,context:1}},
    {calendar:{student:'bruno',kind:'calendar',version:1,payload:{}}},
    {calendar:{student:'ana',kind:'calendar',version:2,payload:{}}},
    {proposal:{id:'other',student:'ana',versions:original}},
    {proposal:{id:'fixture',student:'ana',versions:{calendar:1}}}];
  for(const input of cases)await assert.rejects(PanelHost.prototype.view.call(setup(input).host),/revisions|required|identity/);
});
test('panel reports stale proposals and rejects a concurrent revision',async()=>{
  const x=setup();assert.equal((await PanelHost.prototype.view.call(x.host)).stale,false);
  const stale=setup({proposal:record({context:2,evidence:1,calendar:1})});
  assert.equal((await PanelHost.prototype.view.call(stale.host)).stale,true);
  const changed=setup({latest:{context:2,evidence:1,calendar:1}});
  await assert.rejects(PanelHost.prototype.view.call(changed.host),/changed during read/);
});

test('host rejects unsupported legacy proposal shape',async()=>{
  const unsupported=record();unsupported.payload={near:[event]};
  await assert.rejects(PanelHost.prototype.view.call(setup({proposal:unsupported}).host),/Unsupported proposal/);
});
