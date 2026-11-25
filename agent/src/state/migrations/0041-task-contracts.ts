import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0041-task-contracts',
  up(db) {
    db.exec('ALTER TABLE tasks ADD COLUMN contract TEXT CHECK (contract IS NULL OR json_valid(contract))');
    db.exec('CREATE INDEX task_events_kind ON task_events (kind, seq)');
  },
};
