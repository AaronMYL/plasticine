import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0123-video-collection-order',
  up(db) {
    db.exec('ALTER TABLE video_works ADD COLUMN collect_seq INTEGER');
    db.exec('ALTER TABLE video_works ADD COLUMN space_id TEXT');
    db.exec('CREATE INDEX video_works_collection_order ON video_works (platform, collect_seq DESC, id DESC)');
  },
};
