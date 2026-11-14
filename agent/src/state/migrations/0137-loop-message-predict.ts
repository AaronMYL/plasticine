import type { Migration } from './migrate.ts';

// 预测消息（11-13 Aaron 弹框「接进去」，授权这个迁移）：对话和消息输入框里的输入建议也记进预测闭环，loop_records 的
// area 多一种 message_predict。SQLite 改不了 CHECK，只能照原样建一张新表、把行原样搬过去、删旧表、换名字、重建索引
// （和 0060 一样的官方重建步骤，所以标 destructive）；别的列和约束一个不变，一行不少。
export const migration: Migration = {
  id: '0137-loop-message-predict',
  destructive: true,
  up(db) {
    db.exec(`CREATE TABLE loop_records_next (
      id TEXT PRIMARY KEY NOT NULL,
      area TEXT NOT NULL CHECK (area IN ('note_predict', 'note_supplement', 'suggestion', 'ask', 'message_predict')),
      topic TEXT NOT NULL,
      ref TEXT,
      expected TEXT NOT NULL,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('kept', 'changed', 'rejected')),
      actual TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      CHECK ((outcome IS NULL) = (resolved_at IS NULL)))`);
    db.exec(`INSERT INTO loop_records_next (id, area, topic, ref, expected, outcome, actual, created_at, resolved_at)
      SELECT id, area, topic, ref, expected, outcome, actual, created_at, resolved_at FROM loop_records`);
    db.exec('DROP TABLE loop_records');
    db.exec('ALTER TABLE loop_records_next RENAME TO loop_records');
    db.exec('CREATE INDEX loop_records_topic ON loop_records(area, topic, resolved_at)');
    db.exec('CREATE UNIQUE INDEX loop_records_ref ON loop_records(area, ref) WHERE ref IS NOT NULL');
  },
};
