import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS as EVERY_MIGRATION } from '../../src/state/migrations/index.ts';
import { steppingClock } from './helpers.ts';

// 讲的是 0058 之前的历史：只跑到 0058（0059 起的清理在 retire-migration.test.ts）。
const MIGRATIONS = EVERY_MIGRATION.filter((entry) => entry.id < '0059');

test('旧库从创建事件追溯原对话与消息，worker 子任务继承来源，无来源不猜，重跑不变', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0029'), steppingClock());
    for (const id of ['parent', 'self-child', 'unrelated']) {
      db.run(`INSERT INTO tasks (id, created_at, updated_at, version, title, origin, status, goal_version,
        acceptance, prohibitions, agreement_ids, plan_version, retry_budget, attempts_used, failure_signatures,
        signature_repeats, verifier_policy, results)
        VALUES ($id, 't', 't', 1, '任务', 'user', 'running', 1, '[]', '[]', '[]', 0, 3, 0, '[]', 0, 'brain', '[]')`,
      { id });
    }
    db.run(`INSERT INTO runs (id, created_at, updated_at, version, kind, chat_id, outcome, started_at)
      VALUES ('chat-run', 't', 't', 1, 'conversation', 'original-chat', 'completed', 't')`);
    db.run(`INSERT INTO runs (id, created_at, updated_at, version, kind, task_id, outcome, started_at)
      VALUES ('worker-run', 't', 't', 1, 'task', 'parent', 'completed', 't')`);
    db.run(`INSERT INTO messages (id, created_at, updated_at, version, chat_id, role, content,
      sent_at, run_id, attachments) VALUES ('user-message', 't', 't', 1, 'original-chat',
      'user', '请完成任务', 't', 'chat-run', '[]')`);
    for (const [taskId, runId] of [['parent', 'chat-run'], ['self-child', 'worker-run']] as const) {
      db.run(`INSERT INTO task_events (task_id, run_id, kind, actor, reason, evidence_ids, created_at)
        VALUES ($taskId, $runId, 'created', 'brain', '用户交办', '[]', 't')`, { taskId, runId });
    }
    const before = db.all('SELECT id, title, status, version FROM tasks ORDER BY id');
    assert.deepEqual(migrate(db, MIGRATIONS, steppingClock()), ['0029-task-origins', '0030-task-workchain',
      '0031-note-folders', '0032-cognition-work', '0033-systems-work', '0034-feed-comments',
      '0035-brief-disagreements', '0036-mail-fallback', '0037-books', '0038-projects', '0040-memory-docs', '0041-task-contracts',
      '0042-device-lanes',
      '0043-things', '0044-message-widgets', '0045-bookmarks', '0046-translations', '0047-contacts-network',
      '0048-own-notices', '0049-own-notice-twins',
      '0050-maintenance', '0051-feed-saves-apart', '0052-mail-bodies', '0053-reminder-notices',
      '0054-feed-sources-x', '0055-self-expectations', '0057-ask-basis', '0058-lines']);
    const origins = db.all('SELECT id, source_chat_id, source_message_id FROM tasks ORDER BY id');
    assert.deepEqual(origins.map((row) => ({ ...row })), [
      { id: 'parent', source_chat_id: 'original-chat', source_message_id: 'user-message' },
      { id: 'self-child', source_chat_id: 'original-chat', source_message_id: 'user-message' },
      { id: 'unrelated', source_chat_id: null, source_message_id: null },
    ]);
    assert.deepEqual(db.all('SELECT id, title, status, version FROM tasks ORDER BY id'), before);
    assert.deepEqual(migrate(db, MIGRATIONS, steppingClock()), []);
    assert.deepEqual(db.all('SELECT id, source_chat_id, source_message_id FROM tasks ORDER BY id'), origins);
  } finally { db.close(); }
});
