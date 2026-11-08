// 「定时」里订阅、回顾、心跳、做梦那几行（《优化清单》第 3、7、10、11 条，第 6 批二段）。只加表：
// - timed_slots：一行一条（subscription:<订阅>、review:daily、review:weekly、heartbeat、dream），记下次、上次、它的线、
//   关没关、删没删（删 = 标记，订阅本身留着）、各自的设置和记性（JSON）。
// - heartbeat_beats：心跳叫了模型的那几次（看到了什么、做了什么、一句话）；没有新变化的那一跳不记。

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
