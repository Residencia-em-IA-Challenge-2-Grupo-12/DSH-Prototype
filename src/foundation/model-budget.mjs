import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const roles = ['agent', 'operator', 'judge', 'setup'];

export function formatUsd(value) {
  return Number.isFinite(value) && value >= 0 ? `$${value.toFixed(4)}` : 'unknown';
}

// Approximate local accounting only. It cannot control other users of the key,
// delayed upstream billing or provider-side charges beyond the estimates.
export async function createModelBudget({directory,targetUsd=5}) {
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('An absolute budget directory is required');
  if(!Number.isFinite(targetUsd)||targetUsd<=0||targetUsd>5)throw new Error('The local target must be between zero and $5');
  const target=Math.floor(targetUsd*1_000_000);
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'model-budget.sqlite'),db=new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS budget_config (slot INTEGER PRIMARY KEY CHECK(slot=1), target_micro INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS budget_request (id TEXT PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL, estimate_micro INTEGER NOT NULL, actual_micro INTEGER, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL, settled_at TEXT);');
    db.prepare('INSERT OR IGNORE INTO budget_config(slot,target_micro) VALUES(1,?)').run(target);
    if(db.prepare('SELECT target_micro FROM budget_config WHERE slot=1').get().target_micro!==target)throw new Error('Budget target differs from the existing ledger');
    await fs.chmod(file,0o600);
  } catch(error){db.close();throw error;}
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  return {
    async reserve({role,estimatedUsd}){
      if(!roles.includes(role))throw new Error('Unknown paid-call role');
      if(!Number.isFinite(estimatedUsd)||estimatedUsd<=0)throw new Error('A positive cost estimate is required');
      const estimate=Math.ceil(estimatedUsd*1_000_000),id=randomUUID();
      return transaction(()=>{
        if(db.prepare("SELECT 1 FROM budget_request WHERE status IN ('pending','unknown') LIMIT 1").get())throw new Error('A paid request is pending or has unknown usage');
        const observed=db.prepare("SELECT COALESCE(SUM(actual_micro),0) AS total FROM budget_request WHERE status='settled'").get().total;
        if(observed+estimate>target)throw new Error('Estimated request would exceed the local budget target');
        db.prepare("INSERT INTO budget_request(id,role,status,estimate_micro,created_at) VALUES(?,?,'pending',?,?)").run(id,role,estimate,new Date().toISOString());
        return {id,estimatedUsd:estimate/1_000_000};
      });
    },
    async settle(id,{actualUsd,inputTokens=null,outputTokens=null}={}){
      if(actualUsd!==null&&(!Number.isFinite(actualUsd)||actualUsd<0))throw new Error('Invalid reported cost');
      for(const value of [inputTokens,outputTokens])if(value!==null&&(!Number.isSafeInteger(value)||value<0))throw new Error('Invalid token usage');
      const actual=actualUsd===null?null:Math.ceil(actualUsd*1_000_000);
      return transaction(()=>{
        const request=db.prepare('SELECT status FROM budget_request WHERE id=?').get(id);
        if(!request||request.status!=='pending')throw new Error('Paid request is not pending');
        db.prepare('UPDATE budget_request SET status=?,actual_micro=?,input_tokens=?,output_tokens=?,settled_at=? WHERE id=?').run(actual===null?'unknown':'settled',actual,inputTokens,outputTokens,new Date().toISOString(),id);
      });
    },
    async summary({role} = {}){
      if(role!==undefined){
        if(!roles.includes(role))throw new Error('Unknown paid-call role');
        const row=db.prepare(`SELECT SUM(actual_micro) AS observed, SUM(input_tokens) AS inputTokens,
          SUM(output_tokens) AS outputTokens, SUM(status='pending') AS pending, SUM(status='unknown') AS unknown
          FROM budget_request WHERE role=?`).get(role);
        return {observedUsd:row.pending||row.unknown?null:(row.observed??0)/1_000_000,pendingCount:row.pending||0,unknownCount:row.unknown||0,
          inputTokens:row.inputTokens,outputTokens:row.outputTokens};
      }
      const row=db.prepare("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN actual_micro ELSE 0 END),0) AS observed, SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) AS settled, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END) AS unknown FROM budget_request").get();
      const incomplete=Boolean(row.pending||row.unknown);
      return {targetUsd:target/1_000_000,observedUsd:incomplete&&!row.settled?null:row.observed/1_000_000,totalUsd:incomplete?null:row.observed/1_000_000,pendingCount:row.pending||0,unknownCount:row.unknown||0,limit:'approximate-local'};
    },
    async close(){db.close();}
  };
}
