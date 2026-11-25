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
