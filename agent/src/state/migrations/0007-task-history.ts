// M2 review fixes (4962a40 审查): what a task must remember about its own history. Only additions.
// - original_request: the user's words when the task was handed over; latest_user_quote moves on with every answer.
// - archived_from: the status a task had when it was archived, so only a delivered one counts as a done prerequisite.
// - rework_count: how often it was sent back from 待验收 (退回去改); part of its action ids, so the new round's
//   report is not mistaken for the old round's receipt.
// - task_runs.stalled: the run ended half-way without any progress (no step done, no real tool result); only runs
//   like that in a row count towards the loop guard.
// - diagnosis_plan_version: the plan version a diagnosis set out from, kept across its runs until it ends.
// - push_subscriptions.generation: +1 on subscribing again and unsubscribing; a push result counts for its own one.

import type { Migration } from './migrate.ts';
import { booleanColumn, inList } from './sql.ts';

const TASK_STATUSES = inList([
  'queued',
  'running',
  'waiting_input',
  'waiting_approval',
  'awaiting_acceptance',
  'delivered',
  'partially_delivered',
  'paused',
  'cancelled',
  'archived',
]);

// Tasks from before this migration get their original words back (f7052a3 审查 P1): the first version of the task
// is the task as it was handed over, so its latest_user_quote then was the user's words; a task with no such
// record gets its title (and scope) marked as filled in, so the brief never presents an answer as the request.
const BACKFILL_ORIGINAL_REQUEST = `UPDATE tasks SET original_request = COALESCE(
    (SELECT json_extract(v.snapshot, '$.latestUserQuote') FROM versions AS v
      WHERE v.object_type = 'task' AND v.object_id = tasks.id AND v.version = 1
        AND json_extract(v.snapshot, '$.latestUserQuote') IS NOT NULL),
    '（回填，没有记下交办时的原话）' || title || COALESCE('；' || scope, '')
  )
  WHERE original_request IS NULL`;

// Task action ids changed format with this version (execution/receipts.ts: `:<attempt>:` → `:g<rework>:`). The
// production library held no task receipts when it changed (0 rows, checked read-only 10-28), so nothing is
// converted; a library that does hold task receipts in the old format must not be opened as if they were new —
// their actions would get new ids and run again. The guard fails the whole batch, naming why (ffb36ed 审查 P1).
const OLD_FORMAT_RECEIPT_GUARD = `CREATE TEMP TABLE migration_0007_guard (
    old_format_receipts INTEGER NOT NULL,
    CONSTRAINT 库里有旧格式的任务回执_动作标识不兼容_要先人工核对 CHECK (old_format_receipts = 0)
  );
  INSERT INTO migration_0007_guard (old_format_receipts)
    SELECT COUNT(*) FROM (
      SELECT prefix_ok, substr(after_step, 1, instr(after_step, ':') - 1) AS generation FROM (
        SELECT substr(action_id, 1, length(task_id) + 1) = task_id || ':' AS prefix_ok,
          substr(rest, instr(rest, ':') + 1) AS after_step
        FROM (SELECT action_id, task_id, substr(action_id, length(task_id) + 2) AS rest FROM receipts
          WHERE task_id IS NOT NULL)
      )
    )
    -- <task>:<step>:<generation>:<tool>:<digest>. Step keys hold no colon, so the generation is the third field,
    -- and it must be g followed by digits only: a tool named g1 in an old id does not pass (5a80a22 审查 P2).
    WHERE NOT prefix_ok OR NOT (generation GLOB 'g[0-9]*') OR generation GLOB 'g*[^0-9]*'`;

const STATEMENTS = [
  OLD_FORMAT_RECEIPT_GUARD,
  'ALTER TABLE tasks ADD COLUMN original_request TEXT',
  BACKFILL_ORIGINAL_REQUEST,
  `ALTER TABLE tasks ADD COLUMN archived_from TEXT CHECK (archived_from IS NULL OR archived_from IN ${TASK_STATUSES})`,
  'ALTER TABLE tasks ADD COLUMN rework_count INTEGER NOT NULL DEFAULT 0 CHECK (rework_count >= 0)',
  `ALTER TABLE task_runs ADD COLUMN ${booleanColumn('stalled', 0)}`,
  'ALTER TABLE tasks ADD COLUMN diagnosis_plan_version INTEGER CHECK (diagnosis_plan_version >= 0)',
  'ALTER TABLE push_subscriptions ADD COLUMN generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1)',
];

export const migration: Migration = {
  id: '0007-task-history',
  up(db) {
    for (const statement of STATEMENTS) {
      db.exec(statement);
    }
  },
};
