// 照卡发送的记录（《优化清单》第 3 条，11-07 他定）：以他名义、对象和内容固定的定时发送，每次放行都记下是哪张卡、哪次确认、
// 哪一次到点、发给谁、发了什么、在哪个标签的哪一下。只增不改；硬线放行只认这里的一行（devices/page-submits.ts）。
import type { Migration } from './migrate.ts';
import { RECORD_COLUMNS } from './sql.ts';

const SENDS = `CREATE TABLE schedule_sends (${RECORD_COLUMNS},
  schedule_id TEXT NOT NULL REFERENCES schedules (id),
  confirm_ask_id TEXT NOT NULL,
  confirmed_by_device_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  run_at TEXT,
  tool_call_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  content TEXT NOT NULL,
  node_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  page_version TEXT NOT NULL,
  n INTEGER NOT NULL,
  op TEXT NOT NULL,
  page_url TEXT NOT NULL,
  UNIQUE (line_id, tool_call_id)
)`;

export const migration: Migration = {
  id: '0080-schedule-sends',
  up(db) {
    db.exec(SENDS);
    db.exec('CREATE INDEX schedule_sends_schedule ON schedule_sends (schedule_id, created_at)');
  },
};
