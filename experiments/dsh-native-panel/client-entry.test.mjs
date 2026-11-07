import test from 'node:test';
import assert from 'node:assert/strict';
import {registerPanelBody} from './panel-registration.mjs';

test('panel body waits for its scoped remote service', () => {
  let activate, body;
  const remote={view:async()=>({ok:true,value:{}})};
  const ctx={
    inject:(services,fn)=>{assert.deepEqual(services,['remote.calendarSpike']);activate=fn;},
    slots:{inject:(name,fn)=>{assert.equal(name,'sidebar.right.pane.tab');fn();},
      register:(options,component)=>{assert.equal(options.key,'study-calendar-browser-spike');body=component;}}
  };
  registerPanelBody(ctx,'study-calendar-browser-spike',service=>({service}));
  assert.equal(body,undefined,'body must await the injected service');
  activate({remote:{calendarSpike:remote}});
  assert.equal(body().service,remote);
});
