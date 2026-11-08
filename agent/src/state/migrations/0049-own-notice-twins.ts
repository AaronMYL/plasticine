// 2026-11-04 走查（接 0048）：0048 把收回来的 Plasticine 通知信改成通知以后，10-21 到 10-29 那段每条通知有了两份——
// 一份是从旧服务器迁过来的通知本身（没有 Message-ID），一份是同一条通知发到 Gmail 又收回来的信（有 Message-ID，
// 时间差一两秒）。「设置 · 通知记录」里每条出现两次。这里把有原件的那份信收起来（archived_at，通知记录不显示；
// 不删，原信还在）。认双胞胎：同标题、都是 plasticine 来源、原件没有 Message-ID、时间相差不到 10 分钟。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0049-own-notice-twins',
  up(db) {
    db.exec(`UPDATE inbox_messages SET
      archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      version = version + 1
      WHERE source = 'plasticine' AND message_id IS NOT NULL AND archived_at IS NULL
        AND EXISTS (SELECT 1 FROM inbox_messages AS original
          WHERE original.source = 'plasticine' AND original.message_id IS NULL
            AND original.id <> inbox_messages.id AND original.title = inbox_messages.title
            AND abs(julianday(original.received_at) - julianday(inbox_messages.received_at)) * 86400 < 600)`);
  },
};
