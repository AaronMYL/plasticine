// M4: concerns and 今日 (《实施方案》第 9 节 M4). Only additions (10-26 第 25 条).
// - registrations: 登记 toward a concern's completion criterion (登记 n/10). One row per signup or withdrawal; a
//   source (an old inbox message, an API request) is counted once per concern.
// - feed_sources / feed_items: 信息流 and its sources; one item per dedupe key.
// - brief_items: 十件事, one item per (day, dedupe key), so building the day again adds only what is new.
// - interviews: 采访 questions; each becomes one 要你定卡 (asks.action_id `interview:<id>`).
// - return_briefs: 回来四句话, one per absence (away_since is unique), so a replayed return makes no second brief.
// - trigger_firings: a trigger (命题到期, 完成标准达到) fires once, whatever the scans and restarts.
// - presence: when the user was last active; daily_settings: one row of 今日 settings.
// Enumerations that could grow (feed origins, source kinds, brief categories) are checked by the shared schemas only,
// as state-schema.md 第 2 项 says; the CHECK lists here are the ones the plans fix.

import type { Migration } from './migrate.ts';
import { booleanColumn, inList, jsonColumn, MIGRATION_COLUMNS, OBJECT_COLUMNS, RECORD_COLUMNS } from './sql.ts';

const REGISTRATIONS = `CREATE TABLE registrations (${OBJECT_COLUMNS},
  concern_id TEXT NOT NULL REFERENCES concerns (id),
  criterion_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ${inList(['signup', 'withdrawal'])}),
  label TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source_ref TEXT,
  note TEXT
)`;

const FEED_SOURCES = `CREATE TABLE feed_sources (${OBJECT_COLUMNS},
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  query TEXT,
  level TEXT NOT NULL CHECK (level IN ${inList(['more', 'normal', 'less', 'off'])}),
  concern_id TEXT REFERENCES concerns (id),
  ref TEXT UNIQUE
)`;

const FEED_ITEMS = `CREATE TABLE feed_items (${OBJECT_COLUMNS},
  source_id TEXT NOT NULL REFERENCES feed_sources (id),
  origin TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  site TEXT,
  summary TEXT NOT NULL,
  why TEXT NOT NULL,
  topic TEXT,
  concern_id TEXT REFERENCES concerns (id),
  ref TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  day TEXT NOT NULL,
  published_at TEXT,
  arrived_at TEXT NOT NULL,
  reaction TEXT CHECK (reaction IS NULL OR reaction IN ${inList(['like', 'dislike'])}),
  saved_at TEXT,
  note TEXT,
  seen_at TEXT
)`;

const BRIEF_ITEMS = `CREATE TABLE brief_items (${OBJECT_COLUMNS},
  day TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  category TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight IN (1, 0.5, 0.1)),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_label TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  ${booleanColumn('diff_pending', 0)},
  seen_at TEXT,
  UNIQUE (day, dedupe_key)
)`;

const INTERVIEWS = `CREATE TABLE interviews (${OBJECT_COLUMNS},
  question TEXT NOT NULL,
  question_en TEXT,
  variable TEXT,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ${inList(['pending', 'asked', 'answered', 'skipped'])}),
  ask_id TEXT REFERENCES asks (id),
  asked_at TEXT,
  answer TEXT,
  answered_at TEXT,
  answered_by_device_id TEXT
)`;

const RETURN_BRIEFS = `CREATE TABLE return_briefs (${RECORD_COLUMNS},
  away_since TEXT NOT NULL UNIQUE,
  returned_at TEXT NOT NULL,
  away_ms INTEGER NOT NULL CHECK (away_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ${inList(['composing', 'ready'])}),
  composed_by TEXT CHECK (composed_by IS NULL OR composed_by IN ${inList(['brain', 'data'])}),
  ${jsonColumn('sentences', false)},
  ${booleanColumn('asks_connected', 0)},
  read_at TEXT,
  connected INTEGER CHECK (connected IS NULL OR connected IN (0, 1)),
  read_by_device_id TEXT
)`;

const TRIGGER_FIRINGS = `CREATE TABLE trigger_firings (
  key TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  concern_id TEXT REFERENCES concerns (id),
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  ask_id TEXT REFERENCES asks (id),
  outcome TEXT NOT NULL CHECK (outcome IN ${inList(['card', 'silent'])}),
  fired_at TEXT NOT NULL
)`;

const PRESENCE = `CREATE TABLE presence (
  id TEXT PRIMARY KEY NOT NULL,
  last_active_at TEXT NOT NULL,
  device_id TEXT,
  updated_at TEXT NOT NULL
)`;

const DAILY_SETTINGS = `CREATE TABLE daily_settings (
  id TEXT PRIMARY KEY NOT NULL,
  ${jsonColumn('value', false)},
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL,${MIGRATION_COLUMNS}
)`;

const STATEMENTS = [
  REGISTRATIONS,
  'CREATE INDEX registrations_concern ON registrations (concern_id, criterion_id)',
  `CREATE UNIQUE INDEX registrations_source ON registrations (concern_id, source_ref)
    WHERE source_ref IS NOT NULL`,
  FEED_SOURCES,
  FEED_ITEMS,
  'CREATE INDEX feed_items_arrived ON feed_items (arrived_at)',
  'CREATE INDEX feed_items_concern ON feed_items (concern_id, arrived_at)',
  BRIEF_ITEMS,
  INTERVIEWS,
  'CREATE INDEX interviews_status ON interviews (status, due_at)',
  RETURN_BRIEFS,
  'CREATE INDEX return_briefs_returned ON return_briefs (returned_at)',
  TRIGGER_FIRINGS,
  PRESENCE,
  DAILY_SETTINGS,
  'CREATE INDEX versions_created ON versions (object_type, created_at)',
];

export const migration: Migration = {
  id: '0009-concerns-daily',
  up(db) {
    for (const statement of STATEMENTS) {
      db.exec(statement);
    }
  },
};
