import type { Migration } from './migrate.ts';

const FAVICONS = `CREATE TABLE web_favicons (
  host TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'none')),
  mime TEXT,
  data BLOB,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK ((status = 'ok') = (data IS NOT NULL AND mime IS NOT NULL))
)`;

export const migration: Migration = {
  id: '0110-favicons',
  up(db) {
    db.exec(FAVICONS);
    db.exec('CREATE INDEX web_favicons_expiry ON web_favicons (expires_at)');
  },
};
