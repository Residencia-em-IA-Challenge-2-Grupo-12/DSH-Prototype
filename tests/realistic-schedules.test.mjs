import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, readJSON, makePlan } from '../src/core.mjs';

const weekday=date=>new Date(date.slice(0,10)+'T12:00:00Z').getUTCDay();
const minutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
for(const [name,minimumWork,minimumClass,weeks,target] of [['ana',20,9,4,6],['bruno',40,9,6,5]]){
  test(`${name}: realistic commitments and plans stay within stated study windows`,async()=>{
    const fixture=await readJSON(`${ROOT}/fixtures/calendars/${name}.json`);
    const student=await readJSON(`${ROOT}/fixtures/students/${name}/courses.json`);
    const first=fixture.events.filter(e=>e.start.dateTime?.slice(0,10)>='2026-11-02'&&e.start.dateTime.slice(0,10)<'2026-11-09');
    const duration=kind=>first.filter(e=>e.extendedProperties?.private?.fixtureKind===kind).reduce((s,e)=>s+(Date.parse(e.end.dateTime)-Date.parse(e.start.dateTime))/3600000,0);
    assert(duration('work')>=minimumWork);assert(duration('class')>=minimumClass);
    for(let week=0;week<weeks;week++){
      const from=Date.parse('2026-11-02T00:00:00-03:00')+week*7*86400000,to=from+7*86400000;
      assert(fixture.events.some(e=>e.extendedProperties?.private?.fixtureKind==='work'&&Date.parse(e.start.dateTime)>=from&&Date.parse(e.start.dateTime)<to),'missing work week');
      assert(fixture.events.some(e=>e.extendedProperties?.private?.fixtureKind==='class'&&Date.parse(e.start.dateTime)>=from&&Date.parse(e.start.dateTime)<to),'missing class week');
    }
    assert(fixture.events.some(e=>e.id===name+'-later'),'missing special commitment');
    const plan=makePlan(student,fixture.events,{weeks,hours:target});
    assert.equal(plan.outlook.length,weeks);assert.equal(plan.outlook[0].shortfall,0);
    for(const block of [...plan.near,...plan.future]){
      const start=minutes(block.start.dateTime.slice(11,16)),end=minutes(block.end.dateTime.slice(11,16));
      assert(student.studyWindows.some(w=>w.weekday===weekday(block.start.dateTime)&&start>=minutes(w.start)&&end<=minutes(w.end)),'outside stated window');
      for(const event of fixture.events)assert(!(Date.parse(block.start.dateTime)<Date.parse(event.end.dateTime)&&Date.parse(event.start.dateTime)<Date.parse(block.end.dateTime)),'conflicting commitment');
    }
    const byDay=Map.groupBy([...plan.near,...plan.future],b=>b.start.dateTime.slice(0,10));
    for(const blocks of byDay.values()){
      assert(blocks.length<=student.maxDailyStudyHours,'daily study limit exceeded');
      blocks.sort((a,b)=>Date.parse(a.start.dateTime)-Date.parse(b.start.dateTime));
      for(let i=1;i<blocks.length;i++)assert(Date.parse(blocks[i].start.dateTime)-Date.parse(blocks[i-1].end.dateTime)>=student.studyBreakMinutes*60000,'study break missing');
    }
    const overloaded=makePlan(student,fixture.events,{weeks:1,hours:20});assert(overloaded.outlook[0].shortfall>0);
  });
}

test('missing availability does not turn blank calendar time into available time',()=>{
  const student={student:'ana',targetHours:2,timezone:'America/Sao_Paulo',courses:[{name:'Course',deadline:'2026-11-30T18:00:00-03:00',source:'course.md'}]};
  const plan=makePlan(student,[],{weeks:1,hours:2});assert.equal(plan.near.length,0);assert.equal(plan.outlook[0].shortfall,2);
});

test('an explicit course focus changes allocations and rejects unknown courses',async()=>{
  const student=await readJSON(`${ROOT}/fixtures/students/ana/courses.json`);
  const events=(await readJSON(`${ROOT}/fixtures/calendars/ana.json`)).events;
  const plan=makePlan(student,events,{weeks:1,hours:6,focusCourse:'Statistics'});
  assert.equal(plan.near.filter(e=>e.summary==='Study: Statistics').length,4);
  assert.throws(()=>makePlan(student,events,{focusCourse:'Not a course'}),/not in the student course index/);
});

test('expired courses do not block available focused-course study time or shorten its horizon',()=>{
  const student={student:'ana',timezone:'America/Sao_Paulo',targetHours:6,maxDailyStudyHours:2,studyBreakMinutes:15,
    studyWindows:[1,2,3,4,5].map(weekday=>({weekday,start:'08:00',end:'12:00'})),
    courses:[{name:'Expired',deadline:'2026-10-30T18:00:00-03:00',source:'expired.md'},
      {name:'Active',deadline:'2026-11-30T18:00:00-03:00',source:'active.md'}]};
  const plan=makePlan(student,[],{weeks:4,hours:6,focusCourse:'Active'});
  assert.equal(plan.outlook.length,4);
  assert(plan.outlook.every(week=>week.shortfall===0));
  assert([...plan.near,...plan.future].every(block=>block.summary==='Study: Active'));
});

test('a course is only assigned blocks that finish by its deadline',()=>{
  const student={student:'ana',timezone:'America/Sao_Paulo',targetHours:5,maxDailyStudyHours:2,studyBreakMinutes:15,
    studyWindows:[1,2,3,4,5].map(weekday=>({weekday,start:'08:00',end:'12:00'})),
    courses:[{name:'Soon',deadline:'2026-11-02T09:00:00-03:00',source:'soon.md'},
      {name:'Later',deadline:'2026-11-30T18:00:00-03:00',source:'later.md'}]};
  for(const options of [{},{focusCourse:'Soon'}]){
    const plan=makePlan(student,[],{weeks:1,hours:5,...options});
    assert.equal(plan.outlook[0].shortfall,0);
    assert(plan.near.some(block=>block.summary==='Study: Later'));
    for(const block of plan.near){
      const course=student.courses.find(c=>block.summary==='Study: '+c.name);
      assert(Date.parse(block.end.dateTime)<=Date.parse(course.deadline));
    }
  }
});

test('an entirely expired course list yields no invented study blocks',()=>{
  const student={student:'ana',timezone:'America/Sao_Paulo',targetHours:2,
    studyWindows:[{weekday:1,start:'08:00',end:'12:00'}],
    courses:[{name:'Expired',deadline:'2026-10-30T18:00:00-03:00',source:'expired.md'}]};
  const plan=makePlan(student,[],{weeks:4,hours:2});
  assert.equal(plan.near.length,0);
  assert.equal(plan.outlook.length,1);
  assert.equal(plan.outlook[0].shortfall,2);
});
