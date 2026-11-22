import assert from 'node:assert/strict';
import test from 'node:test';
import {createAvailabilityPreview} from '../src/foundation/availability-preview.mjs';
import {createManagedStudyApi} from '../src/foundation/managed-study-api.mjs';
import {calendarWeekModel} from '../public/calendar-week.js';
import {planningContextChanges,courseMinutes} from '../public/planning-review.js';

const window={date:'2026-11-04',start:'19:00',end:'20:00'};
const event=(id,start,end,extra={})=>({id,summary:id,start:{dateTime:start},end:{dateTime:end},...extra});

test('candidate and real commitment stay distinct and a late conflict fences the structured answer',async()=>{
  let events=[event('commute','2026-11-04T18:00:00-03:00','2026-11-04T19:00:00-03:00')];
  const preview=createAvailabilityPreview({events:async()=>events},'bruno');
  const {id}=await preview.stage([{label:'Wednesday',windows:[window]}]);
  assert.deepEqual(preview.observe(events).options[0].windows[0].conflicts,[]);
  assert.equal(preview.observe(null).options[0].windows[0].conflicts,null);
  let answered=0;
  const question={requestId:'q',questions:[{options:[{label:'Wednesday'}]}]};
  const client={snapshot:async()=>({question}),answer:async()=>{answered++;}};
  const api=createManagedStudyApi({manager:{current:async()=>({id:'r',phase:'active'})},
    driver:{active:()=>({client,service:{availabilityPreview:preview}})}});
  events.push({id:'personal',summary:'Personal day',start:{date:'2026-11-04'},end:{date:'2026-11-05'}});
  const options=preview.observe(events).options;
  const wednesday=calendarWeekModel({events,options}).days[2].blocks;
  assert.equal(wednesday.find(block=>block.event.summary==='Wednesday').kind,'conflict');
  assert.equal(wednesday.find(block=>block.event.id==='personal').kind,'existing');
  await assert.rejects(()=>api.answer('r','q',[{selected:['Wednesday']}],id),/overlaps/);
  assert.equal(answered,0);
  assert.equal(preview.observe()?.id,id);
  await api.answer('r','q',[{selected:[],custom:'Use Sunday'}],id);
  assert.equal(answered,1);
  assert.equal(preview.observe(),null);
});

test('earlier preview batches remain attached and the next question starts with its own options',async()=>{
  let events=[];
  const preview=createAvailabilityPreview({events:async()=>events},'bruno');
  const first=await preview.stage([{label:'Earlier batch',windows:[window]}]);
  const second=await preview.stage([{label:'Later batch',windows:[{...window,date:'2026-11-06'}]}]);
  assert.deepEqual(second.options.map(option=>option.label),['Earlier batch','Later batch']);
  const question={requestId:'grouped',questions:[{options:second.options}]};
  const client={snapshot:async()=>({question}),answer:async()=>{
    await preview.stage([{label:'Next question',windows:[window]}]);
  }};
  const api=createManagedStudyApi({manager:{current:async()=>({id:'r',phase:'active'})},
    driver:{active:()=>({client,service:{availabilityPreview:preview}})}});
  await assert.rejects(()=>api.answer('r','grouped',[{selected:['Earlier batch']}],first.id),/options changed/);
  events=[event('new commitment','2026-11-04T19:00:00-03:00','2026-11-04T20:00:00-03:00')];
  await assert.rejects(()=>api.answer('r','grouped',[{selected:['Earlier batch']}],second.id),/overlaps/);
  await api.answer('r','grouped',[{selected:['Later batch']}],second.id);
  assert.deepEqual(preview.observe().options.map(option=>option.label),['Next question']);
  await assert.rejects(()=>preview.consume(async()=>{throw new Error('Answer rejected');}),/Answer rejected/);
  assert.deepEqual(preview.observe().options.map(option=>option.label),['Next question']);
});

test('confirmation is bound to selected run and original operator replies',async()=>{
  const calls=[];
  let view={busy:true,messages:[]};
  const api=createManagedStudyApi({manager:{current:async()=>({id:'r',phase:'active'})},
    driver:{active:()=>({client:{snapshot:async()=>view},
      service:{confirmPlanningContext:async(...args)=>calls.push(args)}})}});
  await assert.rejects(()=>api.confirmContext('old','revision'),/selected run changed/i);
  await assert.rejects(()=>api.confirmContext('r','revision'),/Finish the current/);
  view={busy:false,messages:[{type:'assistant',text:'Monday allowed'},{type:'user',text:'Keep Monday free'}]};
  await api.confirmContext('r','revision');
  assert.deepEqual(calls,[['revision',['Keep Monday free']]]);
});

test('review shows removed Monday and explicitly counts a course with zero hours',()=>{
  const previous={studyWindows:[{weekday:1,start:'19:00',end:'21:00'}],courses:[],targetHours:5};
  const current={...previous,studyWindows:[{weekday:3,start:'19:00',end:'21:00'}],targetHours:4};
  assert.deepEqual(planningContextChanges(previous,current),{
    removed:previous.studyWindows,added:current.studyWindows,workload:true,dates:false,
  });
  const sources=[{name:'Machine Learning'},{name:'Statistics'}];
  const blocks=[event('study','2026-11-04T14:00:00-03:00','2026-11-04T15:00:00-03:00',
    {extendedProperties:{private:{course:'Machine Learning'}}})];
  assert.deepEqual(courseMinutes(sources,blocks),[['Machine Learning',60],['Statistics',0]]);
});
