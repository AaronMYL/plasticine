// 空间与订阅（《优化清单》第 6、7 条，11-06 定，11-07 补）。只加不改：
// - spaces：一个空间一行，正文是结构化文档（JSON：结论大标题、数字卡、小节、带出处的图表 / 图片 / 引用）。
// - space_revisions：每次保存一版（谁写的、这一版改了什么、Plasticine 提的「以后都这样」），撤销就是恢复上一版。
// - space_subscriptions：订阅就是任务设置（研究周报、个人回顾）；每一期是一个空间（spaces.subscription_id）。
//   表名避开 0062 删掉的旧 subscriptions。
// - notes.moved_to_space_id：「Plasticine 写的」那些笔记迁成空间以后标上去向（0084），行和正文都留着，界面不再出现。
// - note_folders.retired_at：迁走以后这个文件夹不再列出（行留着）。

import type { Migration } from './migrate.ts';
import { inList, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const SPACES = `CREATE TABLE spaces (${RECORD_COLUMNS},
  title TEXT NOT NULL,
  ${jsonColumn('doc', false)},
  author TEXT NOT NULL CHECK (author IN ${inList(['user', 'ai'])}),
  subscription_id TEXT REFERENCES space_subscriptions (id),
  issue_number INTEGER CHECK (issue_number IS NULL OR issue_number >= 1),
  edition TEXT CHECK (edition IS NULL OR edition IN ${inList(['daily', 'weekly'])}),
  source_note_id TEXT,
  deleted_at TEXT
)`;

const REVISIONS = `CREATE TABLE space_revisions (
  space_id TEXT NOT NULL REFERENCES spaces (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL,
  ${jsonColumn('doc', false)},
  author TEXT NOT NULL CHECK (author IN ${inList(['user', 'ai'])}),
  saved_at TEXT NOT NULL,
  change TEXT,
  rule TEXT,
  restored_from INTEGER,
  PRIMARY KEY (space_id, version)
)`;

const SUBSCRIPTIONS = `CREATE TABLE space_subscriptions (${RECORD_COLUMNS},
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ${inList(['research', 'review'])}),
  status TEXT NOT NULL CHECK (status IN ${inList(['draft', 'sample', 'active', 'paused'])}),
  ${jsonColumn('settings', false)},
  time_zone TEXT NOT NULL,
  line_id TEXT,
  last_run_at TEXT
)`;

export const migration: Migration = {
  id: '0083-spaces',
  up(db) {
    db.exec(SUBSCRIPTIONS);
    db.exec(SPACES);
    db.exec(REVISIONS);
    db.exec('CREATE INDEX spaces_updated ON spaces (deleted_at, updated_at)');
    db.exec('CREATE INDEX spaces_subscription ON spaces (subscription_id, issue_number)');
    db.exec('CREATE UNIQUE INDEX spaces_source_note ON spaces (source_note_id) WHERE source_note_id IS NOT NULL');
    db.exec('ALTER TABLE notes ADD COLUMN moved_to_space_id TEXT');
    db.exec('ALTER TABLE note_folders ADD COLUMN retired_at TEXT');
  },
};
