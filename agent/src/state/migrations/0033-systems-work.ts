import type { Migration } from './migrate.ts';
export const migration: Migration = {
  id: '0033-systems-work',
  up(db) {
    db.exec(`CREATE TABLE task_schedules (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL,
      next_at TEXT, body TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX task_schedules_due ON task_schedules (state, next_at)');
    db.exec(`CREATE TABLE task_feedback (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL,
      text TEXT NOT NULL, created_at TEXT NOT NULL, device_id TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX task_feedback_task ON task_feedback (task_id, created_at)');
    db.exec(`CREATE TABLE notification_mail_status (
      id INTEGER PRIMARY KEY CHECK (id = 1), sent_at TEXT, checked_at TEXT NOT NULL, error TEXT
    )`);
  },
};
