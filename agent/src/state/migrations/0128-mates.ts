import type { Migration } from './migrate.ts';
import { RECORD_COLUMNS } from './sql.ts';

export const migration: Migration = {
  id: '0128-mates',
  up(db) {
    db.exec(`CREATE TABLE mates (${RECORD_COLUMNS}, name TEXT NOT NULL, avatar TEXT NOT NULL,
      hue TEXT NOT NULL, role TEXT NOT NULL, soul TEXT NOT NULL, purpose TEXT,
      line_id TEXT NOT NULL UNIQUE REFERENCES lines(id), disabled_at TEXT)`);
    db.exec('CREATE UNIQUE INDEX mates_active_name ON mates(name COLLATE NOCASE) WHERE disabled_at IS NULL');
    db.exec(`CREATE TABLE mate_groups (${RECORD_COLUMNS}, name TEXT NOT NULL,
      mate_ids TEXT NOT NULL CHECK(json_valid(mate_ids)), line_id TEXT NOT NULL UNIQUE REFERENCES lines(id))`);
    db.exec('ALTER TABLE lines ADD COLUMN mate_id TEXT REFERENCES mates(id)');
    db.exec('ALTER TABLE lines ADD COLUMN mate_group_id TEXT REFERENCES mate_groups(id)');
    db.exec('CREATE INDEX lines_mate ON lines(mate_id)');
    db.exec('CREATE INDEX lines_mate_group ON lines(mate_group_id)');
  },
};
