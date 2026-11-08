import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0032-cognition-work',
  up(db) {
    db.exec('ALTER TABLE tasks ADD COLUMN due_at TEXT');
    db.exec("ALTER TABLE tasks ADD COLUMN judgment_ids TEXT NOT NULL DEFAULT '[]'");
    db.exec("ALTER TABLE concerns ADD COLUMN triggers TEXT NOT NULL DEFAULT '[]'");
    db.exec('ALTER TABLE judgments ADD COLUMN deferred_until TEXT');
    db.exec('ALTER TABLE judgments ADD COLUMN assumed_true INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE judgments ADD COLUMN cheapest_test TEXT');
    db.exec('ALTER TABLE asks ADD COLUMN feedback TEXT');
    db.exec('ALTER TABLE asks ADD COLUMN feedback_at TEXT');
    db.exec("ALTER TABLE interviews ADD COLUMN drafts TEXT NOT NULL DEFAULT '[]'");
    db.exec('ALTER TABLE interviews ADD COLUMN posted_at TEXT');
    db.exec('ALTER TABLE interviews ADD COLUMN likes_forecast_id TEXT');
    db.exec('ALTER TABLE interviews ADD COLUMN draft_error TEXT');
  },
};
