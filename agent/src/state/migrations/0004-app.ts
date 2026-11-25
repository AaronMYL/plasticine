import type { Migration } from './migrate.ts';
import { jsonColumn, RECORD_COLUMNS } from './sql.ts';

const DEVICES = `CREATE TABLE devices (${RECORD_COLUMNS},
  name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
)`;

const PAIRING_CODES = `CREATE TABLE pairing_codes (${RECORD_COLUMNS},
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  device_id TEXT REFERENCES devices (id),
  CHECK ((used_at IS NULL) = (device_id IS NULL))
)`;

const SESSIONS = `CREATE TABLE sessions (${RECORD_COLUMNS},
  token_hash TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL REFERENCES devices (id),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
)`;

const API_REQUESTS = `CREATE TABLE api_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  device_id TEXT,
  status INTEGER NOT NULL CHECK (status >= 100 AND status <= 599),
  ${jsonColumn('body', false)},
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`;

const INDEXES = ['CREATE INDEX sessions_device ON sessions (device_id)'];

export const migration: Migration = {
  id: '0004-app',
  up(db) {
    for (const statement of [DEVICES, PAIRING_CODES, SESSIONS, API_REQUESTS, ...INDEXES]) {
      db.exec(statement);
    }
  },
};
