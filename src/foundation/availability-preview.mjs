import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { intervalsOverlap,isBusyCalendarEvent } from '../calendar-time.mjs';

const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const availabilityOptions=z.array(z.strictObject({
  label:z.string().trim().min(1).max(100),
  windows:z.array(z.strictObject({
    date:z.iso.date(),start:time,end:time,
  }).refine(window=>window.start<window.end,'Window must end after it starts')).min(1).max(7),
})).min(1).max(5);

function annotate(preview, events) {
  if(!preview)return null;
  const busy=events?.filter(isBusyCalendarEvent);
  return {...preview,options:preview.options.map(option=>({...option,windows:option.windows.map(window=>{
    const startDateTime=window.date+'T'+window.start+':00-03:00';
    const endDateTime=window.date+'T'+window.end+':00-03:00';
    const candidate={start:{dateTime:startDateTime},end:{dateTime:endDateTime}};
    const conflicts=busy?.filter(event=>intervalsOverlap(event,candidate)).map(event=>({id:event.id,summary:event.summary||''}));
    return {...window,startDateTime,endDateTime,conflicts:conflicts??null};
  })}))};
}

export function createAvailabilityPreview(calendar,student) {
  let current=null;
  return {
    async stage(value) {
      const options=availabilityOptions.parse(value);
      if(new Set(options.map(option=>option.label)).size!==options.length)throw new Error('Use distinct option labels');
      const preview={id:randomUUID(),options};
      current=preview;
      const events=await calendar.events(student).catch(()=>null);
      return annotate(preview,events);
    },
    clear(){current=null;},
    observe(events){return annotate(current,events);},
    async checkSelection(id,labels) {
      if(!id||current?.id!==id)throw new Error('Availability options changed. Refresh and review before answering.');
      const events=await calendar.events(student);
      if(current?.id!==id)throw new Error('Availability options changed. Refresh and review before answering.');
      const selected=this.observe(events).options.filter(option=>labels.includes(option.label));
      if(selected.some(option=>option.windows.some(window=>window.conflicts.length))){
        throw new Error('That option now overlaps a calendar commitment. Choose another option or type an answer.');
      }
    },
  };
}
