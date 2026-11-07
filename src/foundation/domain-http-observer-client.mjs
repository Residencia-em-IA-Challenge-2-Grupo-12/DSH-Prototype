// Trusted local adapter for the read-only calendar observation experiment.
export class DomainRequestError extends Error {
  constructor(status,message,{claimRejected=false}={}) {
    super(`Domain service ${status}: ${message}`);
    this.status=status;
    this.claimRejected=claimRejected;
  }
}
export class DomainObservationClient {
  constructor(origin) {
    const url=new URL(origin);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('A loopback domain-service origin is required');
    this.origin=url.origin;
  }
  async request(student,path,body) {
    if(typeof student!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(student))throw new Error('Invalid student');
    const response=await fetch(`${this.origin}/v1/students/${student}/${path}`,{
      method:body?'POST':'GET',...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)
    });
    const result=await response.json();
    if(!response.ok)throw new DomainRequestError(response.status,result.error||'request failed',{
      claimRejected:[400,404,409].includes(response.status)&&result.claimCommitted===false
    });
    return result;
  }
  currentVersions(student) { return this.request(student,'versions'); }
  addRevision(student,kind,payload,expectedVersion) {
    if(kind!=='calendar')throw new Error('Only calendar observations are supported');
    return this.request(student,'revisions/calendar',{payload,expectedVersion});
  }
  proposal(student,id) {return this.request(student,`proposals/${encodeURIComponent(id)}`);}
  calendarRevision(student,version) {return this.request(student,`revisions/calendar/${version}`);}
  claim(student,id,section,action) {return this.request(student,`proposals/${encodeURIComponent(id)}/applications`,{section,action});}
  application(student,id) {return this.request(student,`applications/${encodeURIComponent(id)}`);}
  applications(student) {return this.request(student,'applications').then(result=>result.items);}
  finish(student,id,state,result) {return this.request(student,`applications/${encodeURIComponent(id)}/finish`,{state,result});}
}
