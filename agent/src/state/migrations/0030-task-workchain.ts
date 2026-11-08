import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0030-task-workchain',
  up(db) {
    db.exec('ALTER TABLE task_runs ADD COLUMN error_message TEXT');
    db.exec('ALTER TABLE task_events ADD COLUMN step_key TEXT');
    db.exec('ALTER TABLE task_events ADD COLUMN error_message TEXT');
    db.exec('CREATE INDEX task_events_history ON task_events(task_id, created_at DESC, seq DESC)');
    db.exec('CREATE INDEX task_runs_history ON task_runs(task_id, created_at DESC, id DESC)');
    db.exec('CREATE INDEX receipts_history ON receipts(task_id, created_at DESC, action_id DESC)');
  },
};
