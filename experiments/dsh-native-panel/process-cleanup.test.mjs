import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {stopChild} from './process-cleanup.mjs';
class Fake extends EventEmitter {
  constructor(mode){super();this.pid=123;this.exitCode=null;this.signalCode=null;this.mode=mode;this.signals=[];}
  kill(signal){this.signals.push(signal);if(this.mode==='term'||(this.mode==='kill'&&signal==='SIGKILL'))setImmediate(()=>{this.signalCode=signal;this.emit('exit',null,signal)});return true;}
}
test('child exit is confirmed and a stalled SIGTERM escalates to SIGKILL',async()=>{
  const graceful=new Fake('term');await stopChild(graceful,{graceMs:50,killGraceMs:50});assert.deepEqual(graceful.signals,['SIGTERM']);
  const forced=new Fake('kill');await stopChild(forced,{graceMs:5,killGraceMs:50});assert.deepEqual(forced.signals,['SIGTERM','SIGKILL']);
});
test('unconfirmed exit fails rather than claiming cleanup succeeded',async()=>{
  const unresponsive=new Fake('none');await assert.rejects(stopChild(unresponsive,{graceMs:5,killGraceMs:5}),/could not be confirmed/);
  assert.deepEqual(unresponsive.signals,['SIGTERM','SIGKILL']);
});
