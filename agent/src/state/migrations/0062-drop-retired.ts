// 删掉随旧 Harness 和删掉的功能一起退役的表（2026-11-05 他定：Harness 推倒重做，删掉的功能连数据一起删）。
// 先搬的已经在 0059（旧对话 → 主线）、0060（关切 → 项目待办）、0061（产出 → 笔记）搬完。这里：
// 1. 留下的表里指向要删的表的那几列清空（卡片的任务 / 事情、回执的任务），再把这几张表重建一遍，
//    去掉指向要删的表的外键（SQLite 改不了外键，只能重建；外键指着一张不存在的表，往这张表写任何一行都会报错）。
//    旧记忆条目的 source_id 不能为空，留着原值，只去掉外键；信息流的 concern_id 也留着原值：它是兴趣和挂在它下面的
//    订阅、命中它的条目共用的那个分组键，关切表没了它照样能把这几样认成一组。
// 2. 退役用途的卡删掉（任务、验收、恢复、采访、关切触发、自迭代、改进、启用、认知、碰撞、事情归属、发到 X 等），
//    连同它们的回答；还在用的用途（记账、备份恢复、设备动作、网络、线的批准和提问）一张不动。
// 3. self_fix、trial_feedback 两条规则和它们的改动记录删掉；自迭代、提醒、产出三个工具组存着的开关删掉。
// 4. 删表。外键由迁移器在外面关掉，所以顺序无所谓；跑完整批之后迁移器再查一遍外键。

import type { Migration, MigrationDb } from './migrate.ts';

/** 删掉的表，按功能分组（汇报和决定记录里列的就是这一份）。 */
export const RETIRED_TABLES = [
  // 旧 Harness：任务和它的附表、运行记录
  'tasks', 'task_events', 'task_steps', 'task_runs', 'task_links', 'task_schedules', 'task_feedback', 'claims',
  'runs', 'run_events',
  // 事情（matters）与进门的细判、订阅
  'matters', 'matter_inputs', 'matter_mandates', 'assessments', 'subscriptions',
  // 自迭代、改进、启用、度量
  'self_jobs', 'self_changes', 'self_deploy_approvals', 'improvement_findings', 'improvement_control',
  'activation_checks', 'activation_decisions', 'activation_features', 'activation_feature_events',
  'telemetry_events', 'telemetry_settings',
  // 采访、判断 / 预测、来源证据账、≠ 标记
  'interviews', 'judgments', 'forecast_probabilities', 'forecast_revisions', 'forecast_samples', 'evidence', 'sources',
  'disagreement_marks', 'disagreement_actions',
  // 专注、自建提醒、回来简报、今日条目、关切的触发记录与登记
  'focus_sessions', 'reminders', 'return_briefs', 'brief_items', 'trigger_firings', 'registrations',
  // 旧对话、关切、产出（已在 0059–0061 搬走）
  'messages', 'message_attachments', 'concerns', 'artifacts', 'artifact_versions',
  // 旧版切换的核对记录、旧的在场记录
  'migration_checks', 'presence',
] as const;

/** 不再出、也没人处理的卡的用途。 */
export const RETIRED_ASK_PURPOSES = [
  'task_input', 'recovery', 'acceptance', 'unknown_result', 'reauth', 'interview', 'concern_trigger', 'self_iteration',
  'improvement', 'activation', 'cognition', 'collision', 'x_publish', 'matter_routing',
] as const;

const RETIRED_RULE_CODES = ['self_fix', 'trial_feedback'] as const;
const RETIRED_TOOL_GROUPS = ['self_code', 'life', 'artifacts'] as const;

/** 留下的表里指向要删的表的外键：表 → [列, 被指的表]。 */
const DANGLING: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  asks: [['task_id', 'tasks'], ['matter_id', 'matters']],
  receipts: [['task_id', 'tasks']],
  feed_sources: [['concern_id', 'concerns']],
  feed_items: [['concern_id', 'concerns']],
  memory_entries: [['source_id', 'sources']],
};
// 这几列只去外键、留原值（见文件头）。
const KEEP_VALUES = new Set(['memory_entries.source_id', 'feed_sources.concern_id', 'feed_items.concern_id']);

function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/** 照 sqlite_master 里的建表语句重建一张表，去掉指向 parents 的外键；索引照原样建回来。 */
function rebuildWithout(db: MigrationDb, table: string, parents: readonly string[]): void {
  const created = db.all("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = $name", { name: table })[0];
  const original = typeof created?.['sql'] === 'string' ? created['sql'] : '';
  let next = original.replace(new RegExp(`^CREATE TABLE "?${table}"?\\s*\\(`), `CREATE TABLE ${table}_rebuilt (`);
  for (const parent of parents) {
    next = next.replace(new RegExp(`\\s+REFERENCES\\s+"?${parent}"?\\s*\\(\\s*id\\s*\\)`, 'g'), '');
  }
  const left = parents.filter((parent) => new RegExp(`REFERENCES\\s+"?${parent}"?\\s*\\(`).test(next));
  if (!next.startsWith(`CREATE TABLE ${table}_rebuilt (`) || left.length > 0) {
    throw new Error(`重建 ${table} 时没认出它的建表语句`);
  }
  const indexes = db.all("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = $name AND sql IS NOT NULL",
    { name: table }).map((row) => String(row['sql']));
  const columns = db.all(`PRAGMA table_info(${table})`).map((row) => String(row['name'])).join(', ');
  db.exec(next);
  db.exec(`INSERT INTO ${table}_rebuilt (${columns}) SELECT ${columns} FROM ${table}`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${table}_rebuilt RENAME TO ${table}`);
  for (const sql of indexes) {
    db.exec(sql);
  }
}

function clearDangling(db: MigrationDb): void {
  for (const [table, links] of Object.entries(DANGLING)) {
    for (const [column] of links) {
      if (!KEEP_VALUES.has(`${table}.${column}`)) {
        db.exec(`UPDATE ${table} SET ${column} = NULL WHERE ${column} IS NOT NULL`);
      }
    }
    rebuildWithout(db, table, links.map(([, parent]) => parent));
  }
}

function dropRetiredRows(db: MigrationDb): void {
  db.exec(`DELETE FROM asks WHERE purpose IN (${quoted(RETIRED_ASK_PURPOSES)})`);
  const rules = `SELECT id FROM rules WHERE code IN (${quoted(RETIRED_RULE_CODES)})`;
  db.exec(`DELETE FROM rule_events WHERE rule_id IN (${rules})`);
  db.exec(`DELETE FROM rules WHERE code IN (${quoted(RETIRED_RULE_CODES)})`);
  db.exec(`DELETE FROM tool_groups WHERE id IN (${quoted(RETIRED_TOOL_GROUPS)})`);
}

export const migration: Migration = {
  id: '0062-drop-retired',
  destructive: true,
  up(db) {
    clearDangling(db);
    dropRetiredRows(db);
    for (const table of RETIRED_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};
