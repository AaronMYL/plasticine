import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0131-video-cover',
  up(db) {
    db.exec('ALTER TABLE video_works ADD COLUMN cover_url TEXT');
  },
};
