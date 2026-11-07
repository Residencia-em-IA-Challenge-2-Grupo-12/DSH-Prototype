// Hand-authored compatibility experiment only; a production build should use Typert generator.
import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
const stringCodec=name=>({mode:'strict',typeSymbol:`study-spike/${name}`,create:()=>z.string()});
export const contribution=createTypertRemoteInfo({package:'study-calendar-spike',methods:{
  'calendarSpike/read':{service:'calendarSpike',invocation:{kind:'direct'},parameters:[
    {name:'student',source:'json',codec:stringCodec('student')},
    {name:'proposalId',source:'json',codec:stringCodec('proposalId')},
  ],result:{mode:'strict',typeSymbol:'study-spike/result',create:()=>z.object({student:z.string(),versions:z.object({context:z.number(),evidence:z.number(),calendar:z.number()}),calendar:z.record(z.string(),z.unknown()),proposal:z.object({id:z.string(),student:z.string(),versions:z.object({context:z.number(),evidence:z.number(),calendar:z.number()}),payload:z.record(z.string(),z.unknown()),createdAt:z.string()}),stale:z.boolean()})}},
}},z);
export const hostContribution={package:'study-calendar-spike',face:'host',schemas:[],get invocations(){return contribution.descriptors},model:{services:[],events:[],objects:[]}};
