// 2026-11-04 用户弹框定：邮件按原样显示（正确解码，保留格式、排版、图片），旧邮件从 Gmail 重新抓回补齐格式、合并重复。
// 只加不改（10-26 第 25 条）：
// 1. inbox_messages 加列：body_html（清洗后的 HTML）、raw_path / raw_sha256（原信落盘在 <状态目录>/mail/raw/<id>.eml，
//    相对路径和 SHA-256）、imap_uid / uid_validity / mailbox（在 Gmail 的位置）、mime_at（整封按 MIME 解析好的时间，
//    mail.refetch 据此跳过补过的）、mime_tried_at（mail.refetch 找过但 Gmail 里没有的时间，重跑时排在没找过的后面，
//    不会每次都卡在同几封上）、duplicate_of（这封是另一封的重复，显示时收起，指向留下的那封）。body 照旧是纯文字，
//    给搜索、脑和列表预览。
// 2. inbox_mail_parts：内嵌图分段（Content-ID、文件名、类型、大小、落盘路径），显示时换成 data:。
// 3. 合并重复放在这里而不是 mail.refetch：规则只看库里已有的列，确定、一次做完，不依赖 Gmail 连得上。线上 80 封里 26 封
//    重复，18 组是旧版迁来的一份（state/import/m5-inbox.ts，legacy_payload 有值、Message-ID 是旧格式）加新同步又抓回的
//    一份（标准 Message-ID）。认法：都是 email、发件地址一样（不分大小写、去两头空白）、标题一样、收信时间相差不到
//    10 分钟（同 0049：两边记的都是信头时间，差的是秒级；同一个人十分钟内两封同标题的信不会一封在旧版、一封在新版）。
//    收起的是旧版那份（新的那份有标准 Message-ID，补得回格式），只写 duplicate_of，不动 archived_at（那是用户的归档）。

import type { Migration } from './migrate.ts';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
// 两份算同一封的最大时间差（秒）。
const TWIN_WINDOW_SECONDS = 600;

const TWIN = `kept.source = 'email' AND kept.legacy_payload IS NULL AND kept.duplicate_of IS NULL
  AND kept.id <> inbox_messages.id
  AND lower(trim(kept.from_address)) = lower(trim(inbox_messages.from_address))
  AND kept.title = inbox_messages.title
  AND abs(julianday(kept.received_at) - julianday(inbox_messages.received_at)) * 86400 < ${TWIN_WINDOW_SECONDS}`;

const COLUMNS = [
  'body_html TEXT',
  'raw_path TEXT',
  'raw_sha256 TEXT',
  'imap_uid INTEGER',
  'uid_validity INTEGER',
  'mailbox TEXT',
  'mime_at TEXT',
  'mime_tried_at TEXT',
  'duplicate_of TEXT REFERENCES inbox_messages (id)',
];

export const migration: Migration = {
  id: '0052-mail-bodies',
  up(db) {
    for (const column of COLUMNS) {
      db.exec(`ALTER TABLE inbox_messages ADD COLUMN ${column}`);
    }
    db.exec(`CREATE TABLE inbox_mail_parts (
      id TEXT PRIMARY KEY NOT NULL,
      message_id TEXT NOT NULL REFERENCES inbox_messages (id),
      content_id TEXT NOT NULL,
      filename TEXT,
      type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size >= 0),
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (message_id, content_id)
    )`);
    db.exec(`UPDATE inbox_messages SET
      duplicate_of = (SELECT kept.id FROM inbox_messages AS kept WHERE ${TWIN}
        ORDER BY abs(julianday(kept.received_at) - julianday(inbox_messages.received_at)), kept.id LIMIT 1),
      updated_at = ${NOW},
      version = version + 1
      WHERE source = 'email' AND legacy_payload IS NOT NULL AND duplicate_of IS NULL
        AND EXISTS (SELECT 1 FROM inbox_messages AS kept WHERE ${TWIN})`);
  },
};
