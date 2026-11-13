import type { Migration } from './migrate.ts';

// 预测闭环（11-13 Aaron 弹框授权这几张新表）：
// - loop_records：Plasticine 做之前的预测（续写那句话、补充的那条、建议卡、推荐的那个选项）和他的反应；
//   一处来源（area + ref）只记一行，结果只填一次。
// - loop_grants：某一类事他点头放手（「这类以后我直接做？」答了「以后直接做」）；收回只记 revoked_at，不删。
// - loop_self_notes：做梦时写的「我自己的说明书」，每次写新的一行，读最新的那一行。
export const migration: Migration = {
  id: '0135-prediction-loop',
  up(db) {
    db.exec(`CREATE TABLE loop_records (
      id TEXT PRIMARY KEY NOT NULL,
      area TEXT NOT NULL CHECK (area IN ('note_predict', 'note_supplement', 'suggestion', 'ask')),
      topic TEXT NOT NULL,
      ref TEXT,
      expected TEXT NOT NULL,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('kept', 'changed', 'rejected')),
      actual TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      CHECK ((outcome IS NULL) = (resolved_at IS NULL)))`);
    db.exec('CREATE INDEX loop_records_topic ON loop_records(area, topic, resolved_at)');
    db.exec('CREATE UNIQUE INDEX loop_records_ref ON loop_records(area, ref) WHERE ref IS NOT NULL');
    db.exec(`CREATE TABLE loop_grants (
      id TEXT PRIMARY KEY NOT NULL,
      topic TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      granted_by_device_id TEXT NOT NULL,
      source_ask_id TEXT NOT NULL,
      revoked_at TEXT,
      revoke_reason TEXT)`);
    db.exec('CREATE INDEX loop_grants_topic ON loop_grants(topic, revoked_at)');
    db.exec(`CREATE TABLE loop_self_notes (
      id TEXT PRIMARY KEY NOT NULL,
      text TEXT NOT NULL,
      written_at TEXT NOT NULL)`);
  },
};
