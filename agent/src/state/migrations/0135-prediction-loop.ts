import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0135-prediction-loop',
  up(db) {
    db.exec(`CREATE TABLE loop_records (
      id TEXT PRIMARY KEY NOT NULL,
      area TEXT NOT NULL CHECK (area IN ('note_predict', 'note_supplement', 'suggestion', 'ask')),
      topic TEXT NOT NULL,
      ref TEXT,
      expected TEXT NOT NULL,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('kept', 'changed', 'rejected')),
      actual TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      CHECK ((outcome IS NULL) = (resolved_at IS NULL)))`);
    db.exec('CREATE INDEX loop_records_topic ON loop_records(area, topic, resolved_at)');
    db.exec('CREATE UNIQUE INDEX loop_records_ref ON loop_records(area, ref) WHERE ref IS NOT NULL');
    db.exec(`CREATE TABLE loop_grants (
      id TEXT PRIMARY KEY NOT NULL,
      topic TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      granted_by_device_id TEXT NOT NULL,
      source_ask_id TEXT NOT NULL,
      revoked_at TEXT,
      revoke_reason TEXT)`);
    db.exec('CREATE INDEX loop_grants_topic ON loop_grants(topic, revoked_at)');
    db.exec(`CREATE TABLE loop_self_notes (
      id TEXT PRIMARY KEY NOT NULL,
      text TEXT NOT NULL,
      written_at TEXT NOT NULL)`);
  },
};
