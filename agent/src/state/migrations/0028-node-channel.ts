// 只增加持久化发送资料和回执摘要。8657250 的默认六类方式已符合 Mac 协议，不重写用户确认过的上限。
import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0028-node-channel',
  up(db) {
    db.exec('ALTER TABLE node_actions ADD COLUMN envelope TEXT CHECK (envelope IS NULL OR json_valid(envelope))');
    db.exec('ALTER TABLE node_actions ADD COLUMN deadline TEXT');
    db.exec('ALTER TABLE node_actions ADD COLUMN report_digest TEXT');
    db.exec('CREATE INDEX node_actions_pending ON node_actions (status, node_id, requested_at)');
  },
};
