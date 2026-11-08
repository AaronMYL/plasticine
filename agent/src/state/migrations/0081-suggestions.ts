// 建议（《优化清单》第 4 条）：Plasticine（以后还有回顾、心跳）主动想到能帮他的事。推测不算他的决定：他点了「开始做」
// 「加成待办」才算，点的那一下记设备和时间；忽略只改状态，行留着（同一个 key 不再提）。
import type { Migration } from './migrate.ts';
import { RECORD_COLUMNS } from './sql.ts';

const SUGGESTIONS = `CREATE TABLE suggestions (${RECORD_COLUMNS},
  title TEXT NOT NULL,
  why TEXT NOT NULL,
  goal TEXT NOT NULL,
  project_id TEXT,
  source TEXT NOT NULL,
  icon TEXT NOT NULL,
  key TEXT,
  source_ref TEXT,
  status TEXT NOT NULL,
  line_id TEXT,
  todo_id TEXT,
  acted_at TEXT,
  acted_by_device_id TEXT,
  CHECK ((acted_at IS NULL) = (acted_by_device_id IS NULL))
)`;

export const migration: Migration = {
  id: '0081-suggestions',
  up(db) {
    db.exec(SUGGESTIONS);
    db.exec('CREATE INDEX suggestions_status ON suggestions (status, created_at)');
    db.exec('CREATE INDEX suggestions_key ON suggestions (key)');
  },
};
