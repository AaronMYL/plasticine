import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0029-task-origins',
  up(db) {
    db.exec('ALTER TABLE tasks ADD COLUMN source_chat_id TEXT');
    db.exec('ALTER TABLE tasks ADD COLUMN source_message_id TEXT');
    // 旧任务尽量从创建事件找回发起对话；worker 发起的自迭代沿父任务追溯，不猜 main。
    db.exec(`WITH RECURSIVE origins(task_id, chat_id, message_id) AS (
      SELECT e.task_id, r.chat_id, m.id FROM task_events e
      JOIN runs r ON r.id = e.run_id AND r.kind = 'conversation'
      LEFT JOIN messages m ON m.run_id = r.id AND m.role = 'user'
      WHERE e.kind = 'created' AND r.chat_id IS NOT NULL
      UNION
      SELECT e.task_id, o.chat_id, o.message_id FROM task_events e
      JOIN runs r ON r.id = e.run_id AND r.kind = 'task'
      JOIN origins o ON o.task_id = r.task_id WHERE e.kind = 'created'
    ) UPDATE tasks SET
      source_chat_id = (SELECT chat_id FROM origins WHERE task_id = tasks.id LIMIT 1),
      source_message_id = (SELECT message_id FROM origins WHERE task_id = tasks.id LIMIT 1)
      WHERE EXISTS (SELECT 1 FROM origins WHERE task_id = tasks.id)`);
  },
};
