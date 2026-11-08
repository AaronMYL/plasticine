// 2026-11-04 用户弹框定（第 115 条）：
// 1. 长期维护入口的操作记录 maintenance_operations：每次写操作一行，带用户原话和结果；操作号是主键，重放只回原结果。
// 2. 信息流命中关注点不再开任务（规则 feed_interest 改成关）：11-03 它给 9 条新闻各开了一件静默试做，全部卡死在
//    技术恢复里每两小时重跑。命中的条目只在信息流里排前面（daily/）。已经关了的不再动；规则还没种的新库由 seed 种成关。
//    先记事件（读到改之前的档位），再改规则。

import type { Migration } from './migrate.ts';

const FEED_INTEREST_REASON = '用户 2026-11-04 弹框定：信息流命中关注点不再开任务，只在信息流里排前面';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export const migration: Migration = {
  id: '0050-maintenance',
  up(db) {
    db.exec(`CREATE TABLE maintenance_operations (
      id TEXT PRIMARY KEY NOT NULL,
      op TEXT NOT NULL,
      args TEXT NOT NULL CHECK (json_valid(args)),
      because TEXT NOT NULL,
      result TEXT NOT NULL CHECK (json_valid(result)),
      created_at TEXT NOT NULL
    )`);
    db.exec(`INSERT INTO rule_events (id, rule_id, kind, from_mode, to_mode, rule_version, actor, evidence_ids,
        reason, at)
      SELECT lower(hex(randomblob(16))), id, 'mode_changed', mode, 'off', rule_version, 'migration', '[]',
        '${FEED_INTEREST_REASON}', ${NOW}
      FROM rules WHERE code = 'feed_interest' AND mode <> 'off'`);
    db.exec(`UPDATE rules SET mode = 'off', version = version + 1, updated_at = ${NOW}
      WHERE code = 'feed_interest' AND mode <> 'off'`);
  },
};
