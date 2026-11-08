// 设置 · 系统「运行情况」读的几样：通知信最近一次发成没有、收信同步、最近的通知卡。2026-11-05 Harness 重做后任务、
// 结果反馈、十件事都没了（表由迁移 0059 删掉），这里不再数它们。

import type { StoreContext } from './object-store.ts';

const nullable = (value: unknown): string | null => value === null || value === undefined ? null : String(value);
export function createSystemOperationsStore(context: StoreContext) {
  const { db } = context;
  return {
    mailResult(sentAt: string | null, error: string | null): void {
      db.run(`INSERT INTO notification_mail_status (id, sent_at, checked_at, error) VALUES (1, $sentAt, $at, $error)
        ON CONFLICT(id) DO UPDATE SET sent_at = coalesce(excluded.sent_at, notification_mail_status.sent_at),
        checked_at = excluded.checked_at, error = excluded.error`, { sentAt, error, at: context.now() });
    },
    /** 通知邮件（提醒、邮件兜底共用一条）最近一次：上次发成的时间、上次尝试的时间和它的错误（成了就是 null）。 */
    mailStatus(): { sentAt: string | null; checkedAt: string | null; error: string | null } {
      const row = db.get('SELECT sent_at, checked_at, error FROM notification_mail_status WHERE id = 1');
      return { sentAt: nullable(row?.['sent_at']), checkedAt: nullable(row?.['checked_at']),
        error: nullable(row?.['error']) };
    },
    read() {
      const sent = db.get("SELECT max(sent_at) AS at FROM inbox_replies WHERE status = 'sent'");
      const reply = db.get('SELECT updated_at, error FROM inbox_replies ORDER BY updated_at DESC LIMIT 1');
      const notification = db.get('SELECT sent_at, checked_at, error FROM notification_mail_status WHERE id = 1');
      const lastError = String(reply?.['updated_at'] ?? '') > String(notification?.['checked_at'] ?? '')
        ? nullable(reply?.['error']) : nullable(notification?.['error']);
      const sentAt = [nullable(sent?.['at']), nullable(notification?.['sent_at'])]
        .filter((at): at is string => at !== null).sort().at(-1) ?? null;
      const received = db.get('SELECT received_at FROM inbox_messages WHERE source = $source '
        + 'ORDER BY received_at DESC LIMIT 1', { source: 'email' });
      const sync = db.get('SELECT last_error FROM inbox_sync WHERE id = $id', { id: 'imap' });
      const asks = db.all('SELECT id, created_at, kind, question FROM asks ORDER BY created_at DESC LIMIT 50');
      return {
        mail: { sentAt, sendError: lastError,
          receivedAt: nullable(received?.['received_at']), receiveError: nullable(sync?.['last_error']) },
        notifications: asks.map((row) => ({ id: `ask:${String(row['id'])}`, at: String(row['created_at']),
          kind: String(row['kind']), summary: String(row['question']), askId: String(row['id']) })),
      };
    },
  };
}
