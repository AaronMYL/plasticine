import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0137-loop-message-predict',
  destructive: true,
  up(db) {
    db.exec(`CREATE TABLE loop_records_next (
      id TEXT PRIMARY KEY NOT NULL,
      area TEXT NOT NULL CHECK (area IN ('note_predict', 'note_supplement', 'suggestion', 'ask', 'message_predict')),
      topic TEXT NOT NULL,
      ref TEXT,
      expected TEXT NOT NULL,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('kept', 'changed', 'rejected')),
      actual TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      CHECK ((outcome IS NULL) = (resolved_at IS NULL)))`);
    db.exec(`INSERT INTO loop_records_next (id, area, topic, ref, expected, outcome, actual, created_at, resolved_at)
      SELECT id, area, topic, ref, expected, outcome, actual, created_at, resolved_at FROM loop_records`);
    db.exec('DROP TABLE loop_records');
    db.exec('ALTER TABLE loop_records_next RENAME TO loop_records');
    db.exec('CREATE INDEX loop_records_topic ON loop_records(area, topic, resolved_at)');
    db.exec('CREATE UNIQUE INDEX loop_records_ref ON loop_records(area, ref) WHERE ref IS NOT NULL');
  },
};
