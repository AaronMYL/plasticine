import type { Migration, MigrationDb } from './migrate.ts';

export const RETIRED_TABLES = [
  'tasks', 'task_events', 'task_steps', 'task_runs', 'task_links', 'task_schedules', 'task_feedback', 'claims',
  'runs', 'run_events',
  'matters', 'matter_inputs', 'matter_mandates', 'assessments', 'subscriptions',
  'self_jobs', 'self_changes', 'self_deploy_approvals', 'improvement_findings', 'improvement_control',
  'activation_checks', 'activation_decisions', 'activation_features', 'activation_feature_events',
  'telemetry_events', 'telemetry_settings',
  'interviews', 'judgments', 'forecast_probabilities', 'forecast_revisions', 'forecast_samples', 'evidence', 'sources',
  'disagreement_marks', 'disagreement_actions',
  'focus_sessions', 'reminders', 'return_briefs', 'brief_items', 'trigger_firings', 'registrations',
  'messages', 'message_attachments', 'concerns', 'artifacts', 'artifact_versions',
  'migration_checks', 'presence',
] as const;

export const RETIRED_ASK_PURPOSES = [
  'task_input', 'recovery', 'acceptance', 'unknown_result', 'reauth', 'interview', 'concern_trigger', 'self_iteration',
  'improvement', 'activation', 'cognition', 'collision', 'x_publish', 'matter_routing',
] as const;

const RETIRED_RULE_CODES = ['self_fix', 'trial_feedback'] as const;
const RETIRED_TOOL_GROUPS = ['self_code', 'life', 'artifacts'] as const;

const DANGLING: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  asks: [['task_id', 'tasks'], ['matter_id', 'matters']],
  receipts: [['task_id', 'tasks']],
  feed_sources: [['concern_id', 'concerns']],
  feed_items: [['concern_id', 'concerns']],
  memory_entries: [['source_id', 'sources']],
};
const KEEP_VALUES = new Set(['memory_entries.source_id', 'feed_sources.concern_id', 'feed_items.concern_id']);

function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

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
