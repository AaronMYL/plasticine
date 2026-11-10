import type { Migration } from './migrate.ts';
import { RECORD_COLUMNS } from './sql.ts';

export const migration: Migration = {
  id: '0126-outbound-grants',
  up(db) {
    db.exec(`CREATE TABLE outbound_grants (${RECORD_COLUMNS},
      actor TEXT NOT NULL, channel TEXT NOT NULL, account TEXT NOT NULL,
      recipient_mode TEXT NOT NULL CHECK (recipient_mode IN ('list', 'all')),
      recipients TEXT NOT NULL CHECK (json_valid(recipients)), category TEXT NOT NULL,
      fixed_texts TEXT CHECK (fixed_texts IS NULL OR json_valid(fixed_texts)),
      scope TEXT NOT NULL CHECK (json_valid(scope)), expires_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)), revoked_at TEXT,
      used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0), last_used_at TEXT,
      confirmed_by_device_id TEXT NOT NULL, confirmed_at TEXT NOT NULL, source_ask_id TEXT,
      legacy_schedule_id TEXT UNIQUE REFERENCES schedules(id))`);
    db.exec('CREATE INDEX outbound_grants_match ON outbound_grants(actor, channel, account)');
    db.exec(`CREATE TABLE outbound_log (
      id TEXT PRIMARY KEY NOT NULL, grant_id TEXT NOT NULL REFERENCES outbound_grants(id),
      actor TEXT NOT NULL, line_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL,
      args_digest TEXT NOT NULL, channel TEXT NOT NULL, account TEXT NOT NULL, recipients TEXT NOT NULL,
      category TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
      summary TEXT NOT NULL, source_ref TEXT, created_at TEXT NOT NULL, finished_at TEXT,
      UNIQUE(line_id, tool_call_id))`);
    db.exec('CREATE INDEX outbound_log_grant ON outbound_log(grant_id, created_at)');
    // 旧卡只确认了网站、名单、内容，没有账号身份；保留专用入口和原任务边界，不能成为通用授权。
    db.exec(`INSERT INTO outbound_grants (id, created_at, updated_at, version, actor, channel, account,
      recipient_mode, recipients, category, fixed_texts, scope, enabled, revoked_at, confirmed_by_device_id,
      confirmed_at, source_ask_id, legacy_schedule_id)
      SELECT 'outbound-schedule:' || s.id, s.confirmed_at, s.confirmed_at, 1, 'line-main',
        json_extract(s.outward, '$.channel'), 'legacy-schedule:' || s.id, 'list',
        json_extract(s.outward, '$.recipients'), json_extract(s.outward, '$.content.kind'),
        CASE WHEN json_extract(s.outward, '$.content.kind') = 'fixed'
          THEN json_extract(s.outward, '$.content.texts') ELSE NULL END,
        json_object('kind', 'task', 'binding', json_object('kind', 'schedule', 'id', s.id)),
        CASE WHEN s.status IN ('active', 'paused') THEN 1 ELSE 0 END,
        CASE WHEN s.status IN ('active', 'paused') THEN NULL ELSE s.updated_at END,
        s.confirmed_by_device_id, s.confirmed_at, s.confirm_ask_id, s.id
      FROM schedules s JOIN asks a ON a.id = s.confirm_ask_id
      WHERE s.outward IS NOT NULL AND s.confirmed_at IS NOT NULL AND s.confirmed_by_device_id IS NOT NULL
        AND a.status = 'answered' AND a.answered_by_device_id = s.confirmed_by_device_id
        AND s.status IN ('active', 'paused', 'replaced', 'removed')`);
    db.exec(`INSERT INTO outbound_log (id, grant_id, actor, line_id, tool_call_id, tool_name, args_digest,
      channel, account, recipients, category, content, status, summary, source_ref, created_at)
      SELECT 'outbound-history:' || sends.id, grants.id, grants.actor, sends.line_id, sends.tool_call_id,
        'schedule_send', 'legacy:' || sends.id, grants.channel, grants.account, json_array(sends.recipient),
        grants.category, sends.content, 'unknown', '历史照卡放行记录，没有可核对的发送回执。',
        'schedule-send:' || sends.id, sends.created_at
      FROM schedule_sends sends JOIN outbound_grants grants ON grants.legacy_schedule_id = sends.schedule_id`);
    db.exec(`UPDATE outbound_grants SET
      used_count = (SELECT count(*) FROM outbound_log WHERE grant_id = outbound_grants.id),
      last_used_at = (SELECT max(created_at) FROM outbound_log WHERE grant_id = outbound_grants.id)
      WHERE legacy_schedule_id IS NOT NULL`);
  },
};
