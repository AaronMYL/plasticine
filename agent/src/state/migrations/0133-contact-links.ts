import type { Migration } from './migrate.ts';

// 第 12 批（11-12 Aaron 同意）：联系人能改备注、删除（只记 removed_at）、绑记忆里的人物页（Plasticine 先问一句，
// 答「不是」记下不再问），记对方 Plasticine 的名字；群里一句话能回某一句（reply_to = 那一句的 messageId）。
export const migration: Migration = {
  id: '0133-contact-links',
  up(db) {
    db.exec('ALTER TABLE contacts ADD COLUMN alias TEXT');
    db.exec('ALTER TABLE contacts ADD COLUMN person_doc_id TEXT');
    db.exec('ALTER TABLE contacts ADD COLUMN link_dismissed_at TEXT');
    db.exec('ALTER TABLE contacts ADD COLUMN removed_at TEXT');
    db.exec('ALTER TABLE contacts ADD COLUMN ai_name TEXT');
    db.exec('ALTER TABLE group_messages ADD COLUMN reply_to TEXT');
  },
};
