// 定时线（《优化清单》第 3 条，11-06 定，11-07 补）：到点替他做一件事。Plasticine 起草一张定时卡（draft），他点确认才生效
// （active）；改了换成新的一张（replaced），删了只标记（removed），行留着：照卡发送的记录要能对回这张卡。
import type { Migration } from './migrate.ts';
import { jsonColumn, RECORD_COLUMNS } from './sql.ts';

const SCHEDULES = `CREATE TABLE schedules (${RECORD_COLUMNS},
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  ${jsonColumn('cadence', false)},
  project_id TEXT NOT NULL,
  report TEXT NOT NULL,
  place TEXT,
  ${jsonColumn('outward', true)},
  replaces_id TEXT REFERENCES schedules (id),
  drafted_by TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  line_id TEXT,
  next_at TEXT,
  last_run_at TEXT,
  last_outcome TEXT,
  last_note TEXT,
  confirm_ask_id TEXT,
  confirmed_at TEXT,
  confirmed_by_device_id TEXT,
  removed_at TEXT,
  CHECK ((confirmed_at IS NULL) = (confirmed_by_device_id IS NULL))
)`;

export const migration: Migration = {
  id: '0079-schedules',
  up(db) {
    db.exec(SCHEDULES);
    db.exec('CREATE INDEX schedules_status ON schedules (status, next_at)');
    db.exec('CREATE INDEX schedules_line ON schedules (line_id)');
  },
};
