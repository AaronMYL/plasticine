import type { Migration } from './migrate.ts';
import { booleanColumn, inList, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const SLOTS = `CREATE TABLE timed_slots (${RECORD_COLUMNS},
  source TEXT NOT NULL CHECK (source IN ${inList(['subscription', 'review', 'heartbeat', 'dream'])}),
  next_at TEXT,
  last_run_at TEXT,
  last_outcome TEXT CHECK (last_outcome IS NULL OR last_outcome IN
    ${inList(['done', 'unmet', 'failed', 'stopped', 'quiet', 'skipped'])}),
  last_note TEXT,
  line_id TEXT,
  ${booleanColumn('enabled', 1)},
  removed_at TEXT,
  ${jsonColumn('config', false)},
  ${jsonColumn('memo', false)}
)`;

const BEATS = `CREATE TABLE heartbeat_beats (${RECORD_COLUMNS},
  at TEXT NOT NULL,
  ${jsonColumn('found', false)},
  ${jsonColumn('did', false)},
  note TEXT NOT NULL,
  ${booleanColumn('failed', 0)}
)`;

export const migration: Migration = {
  id: '0091-timed-slots',
  up(db) {
    db.exec(SLOTS);
    db.exec(BEATS);
    db.exec('CREATE INDEX heartbeat_beats_at ON heartbeat_beats (at)');
  },
};
