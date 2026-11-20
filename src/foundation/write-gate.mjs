// A trusted in-process gate for calendar-writing operations. It cannot kill an
// in-flight provider request; a forced stop needs a separately managed writer
// process and must preserve the unresolved claim before replacement.
export function createWriteGate(){
  let phase='open',active=null;
  return {
    snapshot:()=>({phase,active:active!==null}),
    async run(operation){
      if(phase!=='open')throw new Error('Calendar writes are draining or closed');
      if(active)throw new Error('A calendar write is already in progress');
      if(typeof operation!=='function')throw new Error('A calendar operation is required');
      const pending=Promise.resolve().then(operation);active=pending;
      try{return await pending;}finally{if(active===pending)active=null;}
    },
    async drain({force=false}={}){
      if(typeof force!=='boolean')throw new Error('Force must be an explicit boolean');
      if(phase==='closed')return;
      phase='draining';
      if(active&&force)throw new Error('An in-process calendar writer cannot be verified stopped; retire its process before forcing replacement');
      if(active)await active.catch(()=>{});
      phase='closed';
    }
  };
}
