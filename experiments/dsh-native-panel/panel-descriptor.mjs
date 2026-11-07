// Hand-authored for the pinned-version feasibility test; generate from TS for production.
import {z} from 'zod';
import {createTypertRemoteInfo} from '@deepseek-ai/dsh-typert-protocol/remote-info';
export const contribution=createTypertRemoteInfo({package:'study-calendar-browser-spike',methods:{
 'calendarSpike/view':{service:'calendarSpike',invocation:{kind:'direct'},parameters:[],result:{mode:'strict',typeSymbol:'study-panel/view',create:()=>z.object({student:z.string(),versions:z.object({context:z.number(),evidence:z.number(),calendar:z.number()}),calendar:z.record(z.string(),z.unknown()),proposal:z.object({id:z.string(),student:z.string(),versions:z.object({context:z.number(),evidence:z.number(),calendar:z.number()}),payload:z.record(z.string(),z.unknown()),createdAt:z.string()}),stale:z.boolean()})}}
}},z);
export const hostContribution={package:'study-calendar-browser-spike',face:'host',schemas:[],get invocations(){return contribution.descriptors},model:{services:[],events:[],objects:[]}};
