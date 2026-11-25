import type { Migration } from './migrate.ts';
import { inList } from './sql.ts';

export const migration: Migration = {
  id: '0145-wakes-watches',
  up(db) {
    db.exec(`CREATE TABLE line_wakes (id TEXT PRIMARY KEY NOT NULL, line_id TEXT NOT NULL REFERENCES lines(id),
      call_key TEXT NOT NULL UNIQUE, due_at TEXT NOT NULL, note TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ${inList(['waiting', 'woken', 'cancelled'])}),
      created_at TEXT NOT NULL, ended_at TEXT)`);
    db.exec('CREATE INDEX line_wakes_due ON line_wakes(status, due_at)');
    db.exec(`CREATE TABLE line_watches (id TEXT PRIMARY KEY NOT NULL, line_id TEXT NOT NULL REFERENCES lines(id),
      call_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT, node_id TEXT, tab_id TEXT, look_for TEXT,
      every_minutes INTEGER NOT NULL CHECK (every_minutes >= 1), until_at TEXT NOT NULL, next_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ${inList(['on', 'off', 'ended'])}),
      checks INTEGER NOT NULL DEFAULT 0, changes INTEGER NOT NULL DEFAULT 0, last_text TEXT, last_checked_at TEXT,
      last_error TEXT, created_at TEXT NOT NULL, ended_at TEXT,
      CHECK ((url IS NULL) <> (tab_id IS NULL)), CHECK ((tab_id IS NULL) = (node_id IS NULL)))`);
    db.exec('CREATE INDEX line_watches_next ON line_watches(status, next_at)');
  },
};
