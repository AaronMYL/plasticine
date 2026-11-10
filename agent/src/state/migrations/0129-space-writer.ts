import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0129-space-writer',
  up(db) {
    // 作者线是版本来源；历史没有记录时留空，不按正文猜是谁写的。
    db.exec('ALTER TABLE space_revisions ADD COLUMN line_id TEXT');
    db.exec('CREATE INDEX space_revisions_writer ON space_revisions(line_id)');
  },
};
