// 心跳接手原来的几条后台规则（《优化清单》第 11 条，用户 11-06 定）：项目逾期、会议邀请、要回复、信息流兴趣并进心跳的
// 清单，不再各自触发、各自开线。规则关掉（先记事件，读到改之前的档位，再改），行和事件都留着；触发照常记，心跳读它们。

import type { Migration } from './migrate.ts';

const REASON = '用户 2026-11-06 定（《优化清单》第 11 条）：并进心跳的清单，统一由心跳处理，不再各自触发';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const CODES = "('project_overdue', 'meeting_invite', 'reply_needed', 'feed_interest')";

export const migration: Migration = {
  id: '0092-rules-to-heartbeat',
  up(db) {
    db.exec(`INSERT INTO rule_events (id, rule_id, kind, from_mode, to_mode, rule_version, actor, evidence_ids,
        reason, at)
      SELECT lower(hex(randomblob(16))), id, 'mode_changed', mode, 'off', rule_version, 'migration', '[]',
        '${REASON}', ${NOW}
      FROM rules WHERE code IN ${CODES} AND mode <> 'off'`);
    db.exec(`UPDATE rules SET mode = 'off', version = version + 1, updated_at = ${NOW}
      WHERE code IN ${CODES} AND mode <> 'off'`);
  },
};
