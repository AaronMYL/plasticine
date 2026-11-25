import type { Migration } from './migrate.ts';
import { inList } from './sql.ts';

export const migration: Migration = {
  id: '0146-plans-pushes-connections',
  destructive: true,
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN plan TEXT');
    db.exec(`CREATE TABLE line_watches_new (id TEXT PRIMARY KEY NOT NULL, line_id TEXT NOT NULL REFERENCES lines(id),
      call_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT, node_id TEXT, tab_id TEXT, folder TEXT,
      look_for TEXT, every_minutes INTEGER NOT NULL CHECK (every_minutes >= 1), until_at TEXT NOT NULL,
      next_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ${inList(['on', 'off', 'ended'])}),
      checks INTEGER NOT NULL DEFAULT 0, changes INTEGER NOT NULL DEFAULT 0, last_text TEXT, last_checked_at TEXT,
      last_error TEXT, created_at TEXT NOT NULL, ended_at TEXT,
      CHECK ((url IS NOT NULL) + (tab_id IS NOT NULL) + (folder IS NOT NULL) = 1),
      CHECK ((node_id IS NULL) = (url IS NOT NULL)))`);
    db.exec(`INSERT INTO line_watches_new (id, line_id, call_key, title, url, node_id, tab_id, folder, look_for,
      every_minutes, until_at, next_at, status, checks, changes, last_text, last_checked_at, last_error, created_at,
      ended_at)
      SELECT id, line_id, call_key, title, url, node_id, tab_id, NULL, look_for, every_minutes, until_at, next_at,
      status, checks, changes, last_text, last_checked_at, last_error, created_at, ended_at FROM line_watches`);
    db.exec('DROP TABLE line_watches');
    db.exec('ALTER TABLE line_watches_new RENAME TO line_watches');
    db.exec('CREATE INDEX line_watches_next ON line_watches(status, next_at)');
    db.exec(`CREATE TABLE pushes (id TEXT PRIMARY KEY NOT NULL, line_id TEXT NOT NULL REFERENCES lines(id),
      call_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL,
      withdrawn_at TEXT)`);
    db.exec('CREATE INDEX pushes_recent ON pushes(created_at)');
    db.exec(`CREATE TABLE connections (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
      credential TEXT, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)), tools TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ${inList(['untested', 'ok', 'error'])}), error TEXT, checked_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`);
  },
};
