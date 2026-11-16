import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarWeekModel} from '../public/calendar-week.js';
const event=(id,start,end)=>({id,summary:id,start:{dateTime:start},end:{dateTime:end}});

test('weekly preview uses the simulated week and local times, preserving proposal/observed distinction',()=>{
  const existing=event('work','2026-11-02T11:00:00Z','2026-11-02T20:00:00Z');
  const near=event('study','2026-11-04T19:00:00-03:00','2026-11-04T20:00:00-03:00');
  const future=event('later','2026-11-09T19:00:00-03:00','2026-11-09T20:00:00-03:00');
  const plan={near:[near],future:[future],status:{near:'pending',future:'pending'}};
  const model=calendarWeekModel({events:[existing],plan});
  assert.equal(model.start,'2026-11-02');assert.equal(model.days[0].blocks[0].startMinute,8*60);
  assert.equal(model.days[0].blocks[0].endMinute,17*60);assert.equal(model.days[0].blocks[0].kind,'existing');
  assert.equal(model.days[2].blocks[0].kind,'proposed');assert.equal(model.days[2].blocks[0].section,'near');
  assert.equal(calendarWeekModel({events:[existing],plan,weekOffset:1}).days[0].blocks[0].event.id,'later');
  assert.equal(calendarWeekModel({events:[existing,near],plan:{...plan,status:{near:'applied',future:'pending'}}}).days[2].blocks.length,1);
});

test('weekly preview clips overnight and all-day events with exclusive end dates and marks pending removal',()=>{
  const overnight=event('night','2026-11-02T23:00:00-03:00','2026-11-03T07:00:00-03:00');
  const allDay={id:'deadline',start:{date:'2026-11-04'},end:{date:'2026-11-05'}};
  const model=calendarWeekModel({events:[overnight,allDay],plan:{status:{near:'pending'},remove:{near:[overnight]}}});
  assert.equal(model.days[0].blocks[0].endMinute,1440);assert.equal(model.days[1].blocks[0].endMinute,420);
  assert.equal(model.days[0].blocks[0].kind,'removal');assert.equal(model.days[2].blocks[0].allDay,true);assert.equal(model.days[3].blocks.length,0);
});
