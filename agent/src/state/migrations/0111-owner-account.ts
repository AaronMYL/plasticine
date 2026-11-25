import type { Migration } from './migrate.ts';

const OWNER = `CREATE TABLE owner_account (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'owner'),
  display_name TEXT,
  password_hash TEXT,
  password_salt TEXT,
  password_set_at TEXT,
  setup_token_hash TEXT,
  setup_token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((password_hash IS NULL) = (password_salt IS NULL)),
  CHECK ((password_hash IS NULL) = (password_set_at IS NULL)),
  CHECK ((setup_token_hash IS NULL) = (setup_token_expires_at IS NULL))
)`;

export const migration: Migration = {
  id: '0111-owner-account',
  up(db) {
    db.exec(OWNER);
  },
};
