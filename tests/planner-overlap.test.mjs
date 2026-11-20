import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlan} from '../src/core.mjs';

const student={student:'overlap',timezone:'America/Sao_Paulo',targetHours:2,maxDailyStudyHours:2,studyBreakMinutes:15,studyWindows:[{weekday:1,start:'09:00',end:'12:00'}],courses:[{name:'Course',deadline:'2026-12-01T00:00:00-03:00',source:'fixture'}]};
const event=(id,start,end,extra={})=>({id,summary:id,start:{dateTime:`2026-11-02T${start}:00-03:00`},end:{dateTime:`2026-11-02T${end}:00-03:00`},...extra});
const overlap=(a,b)=>Date.parse(a.start.dateTime)<Date.parse(b.end.dateTime)&&Date.parse(b.start.dateTime)<Date.parse(a.end.dateTime);

test('transparent and cancelled events do not block, but opaque events do',()=>{
  const transparent=event('free','09:00','10:00',{transparency:'transparent'});
  const cancelled=event('cancelled','09:00','10:00',{status:'cancelled'});
  for(const item of [transparent,cancelled])assert(overlap(makePlan(student,[item],{weeks:1,hours:1}).near[0],item));
  const busy=event('busy','09:00','10:00');
  const block=makePlan(student,[busy],{weeks:1,hours:1}).near[0];
  assert(!overlap(block,busy));
  assert.equal(block.start.dateTime,'2026-11-02T10:00:00-03:00');
});

test('proposed study blocks do not overlap and retain the configured break',()=>{
  const plan=makePlan(student,[],{weeks:1,hours:2});
  assert.equal(plan.near.length,2);
  assert(!overlap(plan.near[0],plan.near[1]));
  assert(Date.parse(plan.near[1].start.dateTime)-Date.parse(plan.near[0].end.dateTime)>=15*60000);
});

test('all-day busy dates use local midnight and an exclusive end',()=>{
  const evening={...student,studyWindows:[{weekday:1,start:'21:00',end:'23:00'},{weekday:2,start:'21:00',end:'23:00'},{weekday:3,start:'21:00',end:'23:00'}]};
  const allDay={id:'all-day',summary:'all day',start:{date:'2026-11-03'},end:{date:'2026-11-04'}};
  // Monday night is before the all-day event; Tuesday night is inside it;
  // Wednesday night follows its exclusive end.
  for(const [date,expected] of [['2026-11-02',1],['2026-11-03',0],['2026-11-04',1]]){
    const otherDates=['2026-11-02','2026-11-03','2026-11-04'].filter(d=>d!==date);
    assert.equal(makePlan(evening,[allDay],{weeks:1,hours:1,avoidDates:otherDates}).near.length,expected,date);
  }
  assert.equal(makePlan(evening,[{...allDay,transparency:'transparent'}],{weeks:1,hours:1,avoidDates:['2026-11-02','2026-11-04']}).near.length,1);
});
