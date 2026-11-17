// 设置 · 系统「运行情况」读的几样：最近一次回信发成没有、收信同步、最近的通知卡。2026-11-05 Harness 重做后任务、
// 结果反馈、十件事都没了（表由迁移 0059 删掉），这里不再数它们。11-17：通知邮件早就不发了（改发消息和系统通知），
// 不再读 notification_mail_status 那一行（里面停在 11-04 的旧时间会一直显示成「最近发信」）；表还在，没人写。

import type { StoreContext } from './object-store.ts';

const nullable = (value: unknown): string | null => value === null || value === undefined ? null : String(value);
export function createSystemOperationsStore(context: StoreContext) {
  const { db } = context;
  return {
    read() {
      const sent = db.get("SELECT max(sent_at) AS at FROM inbox_replies WHERE status = 'sent'");
      const reply = db.get('SELECT updated_at, error FROM inbox_replies ORDER BY updated_at DESC LIMIT 1');
      const lastError = nullable(reply?.['error']);
      const sentAt = nullable(sent?.['at']);
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
