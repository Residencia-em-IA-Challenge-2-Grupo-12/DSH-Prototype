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

export class DomainStore {
  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const schema = this.db.prepare('PRAGMA user_version').get().user_version;
    if (schema > 1) { this.db.close(); throw new Error('Unsupported domain store schema version'); }
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
      CREATE TRIGGER IF NOT EXISTS immutable_revisions_update BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'revisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_revisions_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'revisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_proposals_update BEFORE UPDATE ON proposals BEGIN SELECT RAISE(ABORT,'proposals are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_proposals_delete BEFORE DELETE ON proposals BEGIN SELECT RAISE(ABORT,'proposals are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_decisions_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT,'decisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_decisions_delete BEFORE DELETE ON decisions BEGIN SELECT RAISE(ABORT,'decisions are immutable'); END;
      PRAGMA user_version=1;
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
  addRevision(student, kind, payload, expectedVersion) {
    identifier(student,'student');
    if (!KINDS.has(kind)) throw new Error('Invalid revision kind');
    const body=objectJSON(payload,'Revision'); version(expectedVersion);
    return this.transaction(()=>{
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
}
