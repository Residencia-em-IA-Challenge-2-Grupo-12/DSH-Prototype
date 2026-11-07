// Standalone foundation experiment. The existing application does not use this store yet.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const KINDS = new Set(['context', 'evidence', 'calendar']);
const SECTIONS = new Set(['near', 'future']);
const CHOICES = new Set(['approve', 'reject']);

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function objectJSON(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const result = JSON.stringify(value);
  if (!result || result === 'null') throw new Error(`${label} must be serializable`);
  return result;
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid version');
  return value;
}
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
const canonicalJSON=value=>JSON.stringify(canonical(value));

export class DomainStore {
  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const schema = this.db.prepare('PRAGMA user_version').get().user_version;
    if (schema > 3) { this.db.close(); throw new Error('Unsupported domain store schema version'); }
    if (schema === 2) {
      // Preserve existing application claims while adding the review state.
      this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE applications RENAME TO applications_v2;
        CREATE TABLE applications (
          id TEXT PRIMARY KEY, student TEXT NOT NULL, proposal_id TEXT NOT NULL,
          section TEXT NOT NULL CHECK(section IN ('near','future')), action TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('pending','completed','failed','unknown','review')),
          result TEXT, created_at TEXT NOT NULL, finished_at TEXT,
          FOREIGN KEY(student,proposal_id) REFERENCES proposals(student,id),
          UNIQUE(proposal_id,section)
        );
        INSERT INTO applications SELECT * FROM applications_v2;
        DROP TABLE applications_v2;
        PRAGMA user_version=3;
        COMMIT;`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS revisions (
        student TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('context','evidence','calendar')),
        version INTEGER NOT NULL CHECK (version > 0), payload TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (student, kind, version)
      );
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY, student TEXT NOT NULL, context_version INTEGER NOT NULL,
        evidence_version INTEGER NOT NULL, calendar_version INTEGER NOT NULL,
        payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(student,id)
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY, student TEXT NOT NULL, proposal_id TEXT NOT NULL,
        section TEXT NOT NULL CHECK(section IN ('near','future')),
        choice TEXT NOT NULL CHECK(choice IN ('approve','reject')), created_at TEXT NOT NULL,
        FOREIGN KEY(student,proposal_id) REFERENCES proposals(student,id),
        UNIQUE(proposal_id,section)
      );
      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY, student TEXT NOT NULL, proposal_id TEXT NOT NULL,
        section TEXT NOT NULL CHECK(section IN ('near','future')), action TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','completed','failed','unknown','review')),
        result TEXT, created_at TEXT NOT NULL, finished_at TEXT,
        FOREIGN KEY(student,proposal_id) REFERENCES proposals(student,id),
        UNIQUE(proposal_id,section)
      );
      CREATE TRIGGER IF NOT EXISTS immutable_revisions_update BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'revisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_revisions_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'revisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_proposals_update BEFORE UPDATE ON proposals BEGIN SELECT RAISE(ABORT,'proposals are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_proposals_delete BEFORE DELETE ON proposals BEGIN SELECT RAISE(ABORT,'proposals are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_decisions_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT,'decisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_decisions_delete BEFORE DELETE ON decisions BEGIN SELECT RAISE(ABORT,'decisions are immutable'); END;
      PRAGMA user_version=3;
    `);
  }

  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  currentVersions(student) {
    identifier(student,'student');
    const rows=this.db.prepare('SELECT kind, MAX(version) AS version FROM revisions WHERE student=? GROUP BY kind').all(student);
    return Object.assign({ context:0, evidence:0, calendar:0 },Object.fromEntries(rows.map(row=>[row.kind,row.version])));
  }
  requireUnlocked(student) {
    if(this.db.prepare("SELECT 1 FROM applications WHERE student=? AND state IN ('pending','unknown','review') LIMIT 1").get(student))throw new Error('Application pending or needs reconciliation');
  }
  addRevision(student, kind, payload, expectedVersion) {
    identifier(student,'student');
    if (!KINDS.has(kind)) throw new Error('Invalid revision kind');
    const body=objectJSON(payload,'Revision'); version(expectedVersion);
    return this.transaction(()=>{
      this.requireUnlocked(student);
      const current=this.currentVersions(student)[kind];
      if(current!==expectedVersion) throw new Error(`STALE: ${kind} revision changed`);
      const result={student,kind,version:current+1,payload:JSON.parse(body),createdAt:new Date().toISOString()};
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?)').run(student,kind,result.version,body,result.createdAt);
      return result;
    });
  }
  getRevision(student,kind,number) {
    identifier(student,'student'); if(!KINDS.has(kind))throw new Error('Invalid revision kind'); version(number);
    const row=this.db.prepare('SELECT * FROM revisions WHERE student=? AND kind=? AND version=?').get(student,kind,number);
    return row ? {student:row.student,kind:row.kind,version:row.version,payload:JSON.parse(row.payload),createdAt:row.created_at} : null;
  }
  createProposal(student,versions,payload) {
    identifier(student,'student');
    const body=objectJSON(payload,'Proposal');
    for(const kind of KINDS) if(version(versions?.[kind])===0) throw new Error(`Missing ${kind} revision`);
    return this.transaction(()=>{
      this.requireUnlocked(student);
      this.requireCurrent(student,versions);
      const result={id:randomUUID(),student,versions:{context:versions.context,evidence:versions.evidence,calendar:versions.calendar},payload:JSON.parse(body),createdAt:new Date().toISOString()};
      this.db.prepare('INSERT INTO proposals VALUES (?,?,?,?,?,?,?)').run(result.id,student,versions.context,versions.evidence,versions.calendar,body,result.createdAt);
      return result;
    });
  }
  getProposal(student,id) {
    identifier(student,'student'); identifier(id,'proposal');
    const row=this.db.prepare('SELECT * FROM proposals WHERE student=? AND id=?').get(student,id);
    return row ? {id:row.id,student:row.student,versions:{context:row.context_version,evidence:row.evidence_version,calendar:row.calendar_version},payload:JSON.parse(row.payload),createdAt:row.created_at} : null;
  }
  requireCurrent(student,versions) {
    const current=this.currentVersions(student);
    for(const kind of KINDS) if(current[kind]!==versions[kind])throw new Error(`STALE: ${kind} revision changed`);
  }
  decide(student,proposalId,section,choice) {
    identifier(student,'student'); identifier(proposalId,'proposal');
    if(!SECTIONS.has(section)||!CHOICES.has(choice))throw new Error('Invalid decision');
    return this.transaction(()=>{
      this.requireUnlocked(student);
      const proposal=this.getProposal(student,proposalId);
      if(!proposal)throw new Error('Unknown proposal');
      this.requireCurrent(student,proposal.versions);
      if(this.getDecision(student,proposalId,section))throw new Error('Section already decided');
      const decision={id:randomUUID(),student,proposalId,section,choice,createdAt:new Date().toISOString()};
      this.db.prepare('INSERT INTO decisions VALUES (?,?,?,?,?,?)').run(decision.id,student,proposalId,section,choice,decision.createdAt);
      return decision;
    });
  }
  getDecision(student,proposalId,section) {
    identifier(student,'student'); identifier(proposalId,'proposal'); if(!SECTIONS.has(section))throw new Error('Invalid section');
    const row=this.db.prepare('SELECT * FROM decisions WHERE student=? AND proposal_id=? AND section=?').get(student,proposalId,section);
    return row ? {id:row.id,student:row.student,proposalId:row.proposal_id,section:row.section,choice:row.choice,createdAt:row.created_at} : null;
  }
  // This checks local records only: an external calendar can still change after
  // the transaction. The future writer must re-read it and reconcile failures.
  assertApprovalCurrent(student,proposalId,section) {
    return this.transaction(()=>{
      const proposal=this.getProposal(student,proposalId);
      if(!proposal)throw new Error('Unknown proposal');
      this.requireCurrent(student,proposal.versions);
      const decision=this.getDecision(student,proposalId,section);
      if(decision?.choice!=='approve')throw new Error('Section not approved');
      return decision;
    });
  }
  claimApplication(student,proposalId,section,action) {
    identifier(student,'student');identifier(proposalId,'proposal');
    if(!SECTIONS.has(section))throw new Error('Invalid section');
    const actionBody=objectJSON(action,'Action');
    return this.transaction(()=>{
      this.requireUnlocked(student);
      const proposal=this.getProposal(student,proposalId);
      if(!proposal)throw new Error('Unknown proposal');
      this.requireCurrent(student,proposal.versions);
      const decision=this.getDecision(student,proposalId,section);
      if(decision?.choice!=='approve')throw new Error('Section not approved');
      const approved=proposal.payload?.sections?.[section]?.action;
      if(!approved||canonicalJSON(approved)!==canonicalJSON(JSON.parse(actionBody)))throw new Error('Action does not match approved proposal');
      if(this.db.prepare('SELECT 1 FROM applications WHERE proposal_id=? AND section=?').get(proposalId,section))throw new Error('Application already claimed');
      const claim={id:randomUUID(),student,proposalId,section,action:JSON.parse(actionBody),state:'pending',result:null,createdAt:new Date().toISOString(),finishedAt:null};
      this.db.prepare('INSERT INTO applications VALUES (?,?,?,?,?,?,?,?,?)').run(claim.id,student,proposalId,section,actionBody,claim.state,null,claim.createdAt,null);
      return claim;
    });
  }
  getApplication(student,claimId) {
    identifier(student,'student');identifier(claimId,'application');
    const row=this.db.prepare('SELECT * FROM applications WHERE student=? AND id=?').get(student,claimId);
    return row?{id:row.id,student:row.student,proposalId:row.proposal_id,section:row.section,action:JSON.parse(row.action),state:row.state,result:row.result?JSON.parse(row.result):null,createdAt:row.created_at,finishedAt:row.finished_at}:null;
  }
  listApplications(student) {
    identifier(student,'student');
    return this.db.prepare('SELECT id,proposal_id,section,state,created_at,finished_at FROM applications WHERE student=? ORDER BY created_at,id').all(student)
      .map(row=>({id:row.id,proposalId:row.proposal_id,section:row.section,state:row.state,createdAt:row.created_at,finishedAt:row.finished_at}));
  }
  finishApplication(student,claimId,state,result) {
    identifier(student,'student');identifier(claimId,'application');
    if(!['completed','failed','unknown','review'].includes(state))throw new Error('Invalid application state');
    const body=objectJSON(result,'Application result');
    if(state==='completed'&&(!result.actualState||typeof result.actualState!=='object'))throw new Error('Completed application needs actual state');
    if(state==='completed'&&(result.requiresReview===true||result.unexpectedCalendarChange===true||result.conflictingEventIds?.length||result.unresolvedEventIds?.length))throw new Error('Application requires reconciliation');
    if(state==='review'&&(!result.actualState||typeof result.actualState!=='object'||result.requiresReview!==true))throw new Error('Review state needs actual state and a review reason');
    return this.transaction(()=>{
      const claim=this.getApplication(student,claimId);
      if(!claim)throw new Error('Unknown application');
      if(claim.state!=='pending')throw new Error('Application already finalized');
      if(result.actualState&&typeof result.actualState==='object') {
        const calendarVersion=this.currentVersions(student).calendar;
        this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?)').run(student,'calendar',calendarVersion+1,JSON.stringify(result.actualState),new Date().toISOString());
      }
      this.db.prepare('UPDATE applications SET state=?,result=?,finished_at=? WHERE id=?').run(state,body,new Date().toISOString(),claimId);
      return this.getApplication(student,claimId);
    });
  }
}
