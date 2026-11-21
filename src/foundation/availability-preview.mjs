import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const availabilityOptions=z.array(z.strictObject({
  label:z.string().trim().min(1).max(100),
  windows:z.array(z.strictObject({
    date:z.iso.date(),start:time,end:time,
  }).refine(window=>window.start<window.end,'Window must end after it starts')).min(1).max(7),
})).min(1).max(5);

const timeOf=(value,dateKey)=>Date.parse(value?.dateTime||
  (value?.date?value.date+'T00:00:00-03:00':dateKey+'T00:00:00-03:00'));

export function createAvailabilityPreview(calendar,student) {
  let current=null;
  return {
    stage(value) {
      const options=availabilityOptions.parse(value);
      if(new Set(options.map(option=>option.label)).size!==options.length)throw new Error('Use distinct option labels');
      current={id:randomUUID(),options};
      return current;
    },
    clear(){current=null;},
    observe(events) {
      if(!current) return null;
      return {...current,options:current.options.map(option=>({...option,windows:option.windows.map(window=>{
        const start=window.date+'T'+window.start+':00-03:00',end=window.date+'T'+window.end+':00-03:00';
        const conflicts=events?.filter(event=>event.status!=='cancelled'&&event.transparency!=='transparent'&&
          Date.parse(start)<timeOf(event.end,window.date)&&timeOf(event.start,window.date)<Date.parse(end));
        return {...window,startDateTime:start,endDateTime:end,conflicts:conflicts?.map(event=>({id:event.id,summary:event.summary||''}))??null};
      })}))};
    },
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
