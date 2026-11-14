import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { StateError } from '../../src/state/errors.ts';
import { appliedMigrations, migrate, MIGRATIONS, type Migration } from '../../src/state/migrations/index.ts';
import { RETIRED_TABLES } from '../../src/state/migrations/0062-drop-retired.ts';
import { openState } from '../../src/state/index.ts';
import { steppingClock, tempDirectory, throwsState } from './helpers.ts';

// 旧任务表的十种状态（任务 2026-11-05 删了，表在 0062 删；这里只核对历史迁移建出来的 CHECK）。
const TASK_STATUSES = ['queued', 'running', 'waiting_input', 'waiting_approval', 'awaiting_acceptance', 'delivered',
  'partially_delivered', 'paused', 'cancelled', 'archived'] as const;

// 0059 起是 2026-11-05 的清理（旧对话进主线、关切进项目、产出进笔记、删退役的表）。下面那些「旧库补跑」的测试
// 讲的是 0058 之前的历史，只跑到 0058；清理本身在 retire-migration.test.ts。
const HISTORY = MIGRATIONS.filter((entry) => entry.id < '0059');
const RETIRE = ['0059-main-line', '0060-project-todos', '0061-artifact-notes', '0062-drop-retired'];
// 清理之后只加列的迁移。
const AFTER_RETIRE = ['0063-line-message-meta', '0064-network-groups', '0065-line-control-and-origins',
  '0066-line-archive', '0067-search-index', '0070-memory-layers', '0071-memory-journal', '0072-memory-dreams',
  '0077-line-verdict', '0079-schedules', '0080-schedule-sends',
  '0081-suggestions', '0082-device-time-zones', '0083-spaces',
  '0084-ai-notes-to-spaces', '0087-line-days', '0088-side-lines',
  '0090-line-purpose', '0091-timed-slots', '0092-rules-to-heartbeat',
  '0094-feed-translations', '0095-video-works', '0098-erase-deleted-memory',
  '0103-archive-self-change-memory', '0104-plasticine-project-goal', '0106-calendar-snapshots', '0109-web-tabs',
  '0110-favicons', '0111-owner-account', '0112-device-local',
  '0113-feed-source-removed', '0120-note-suggest-thinking',
  '0121-bookmarks-apart', '0122-space-pages', '0123-video-collection-order', '0124-content-metadata',
  '0125-library-purge', '0126-outbound-grants', '0127-network-attachments', '0128-mates', '0129-space-writer',
  '0130-memory-scope', '0131-video-cover', '0132-memory-cleanups', '0133-contact-links',
  '0134-mate-characters', '0135-prediction-loop', '0136-mate-looks',
  '0137-loop-message-predict', '0138-feed-places-body', '0139-souls'];

// M5 乙路的迁移（排在甲路的 0011 后面）。
const GAPS = [
  '0014-note-history',
  '0015-terms',
  '0016-forecasts',
  '0017-attachments',
  '0018-money-drafts',
  '0019-improvements',
  '0020-client-updates',
  '0021-backups',
  '0022-disagreement-proposals',
  '0023-external-feed',
  '0024-activation',
  '0025-self-code',
  '0026-feed-search',
  '0027-self-code-enabled',
  '0028-node-channel',
  '0029-task-origins',
  '0030-task-workchain',
  '0031-note-folders',
  '0032-cognition-work',
  '0033-systems-work',
  '0034-feed-comments',
  '0035-brief-disagreements',
  '0036-mail-fallback',
  '0037-books',
  '0038-projects',
  '0040-memory-docs', '0041-task-contracts',
  '0042-device-lanes',
  '0043-things',
  '0044-message-widgets',
  '0045-bookmarks',
  '0046-translations',
  '0047-contacts-network',
  '0048-own-notices',
  '0049-own-notice-twins',
  '0050-maintenance',
  '0051-feed-saves-apart',
  '0052-mail-bodies',
  '0053-reminder-notices',
  '0054-feed-sources-x',
  '0055-self-expectations',
  '0057-ask-basis',
  '0058-lines',
];
const M5B = ['0012-life-inbox-artifacts', '0013-reading-to-manual', ...GAPS];

test('自迭代开关迁移只打开已有 self_code 行，之后用户关闭不会被再次打开', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = () => '2026-10-29T00:00:00.000Z';
    migrate(db, HISTORY.filter((entry) => entry.id < '0027'), now);
    for (const id of ['self_code', 'cloud_ssh']) {
      db.run(`INSERT INTO tool_groups (id, enabled, version, updated_at,
        confirmed_by_device_id, confirmed_by_device_at) VALUES ($id, 0, 3, $now, 'device', $now)`, { id, now: now() });
    }
    migrate(db, HISTORY, now);
    assert.equal(db.get("SELECT enabled FROM tool_groups WHERE id = 'self_code'")?.['enabled'], 1);
    assert.equal(db.get("SELECT version FROM tool_groups WHERE id = 'self_code'")?.['version'], 4);
    assert.equal(db.get("SELECT enabled FROM tool_groups WHERE id = 'cloud_ssh'")?.['enabled'], 0);
    db.run("UPDATE tool_groups SET enabled = 0 WHERE id = 'self_code'");
    migrate(db, HISTORY, now);
    assert.equal(db.get("SELECT enabled FROM tool_groups WHERE id = 'self_code'")?.['enabled'], 0);
  } finally { db.close(); }
});

const ALL_MIGRATIONS = [
  '0001-objects',
  '0002-tasks',
  '0003-records',
  '0004-app',
  '0005-notes',
  '0006-tasks-asks',
  '0007-task-history',
  '0008-memory-judgments',
  '0009-concerns-daily',
  '0010-trigger-generations',
  '0011-devices-self', ...M5B,
];

const TABLES_0058 = [
  'activation_checks',
  'activation_decisions',
  'activation_feature_events',
  'activation_features',
  'agreements',
  'api_requests',
  'artifact_versions',
  'artifacts',
  'asks',
  'assessments',
  'attachments',
  'backups',
  'book_annotations',
  'book_insights',
  'book_progress',
  'bookmarks',
  'books',
  'brief_items',
  'claims',
  'client_publications',
  'client_updates',
  'concerns',
  'contact_messages',
  'contacts',
  'daily_settings',
  'device_keys',
  'devices',
  'disagreement_actions',
  'disagreement_marks',
  'evidence',
  'feed_comments',
  'feed_fetch_runs',
  'feed_items',
  'feed_refresh_runs',
  'feed_source_status',
  'feed_sources',
  'focus_sessions',
  'forecast_probabilities',
  'forecast_revisions',
  'forecast_samples',
  'improvement_control',
  'improvement_findings',
  'inbox_mail_parts',
  'inbox_messages',
  'inbox_replies',
  'inbox_sync',
  'intake_sources',
  'interviews',
  'judgments',
  'kernel_credentials',
  'kernel_settings',
  'legacy_ids',
  'legacy_rows',
  'line_approvals',
  'line_messages',
  'line_queue',
  'lines',
  'mail_fallback_settings',
  'maintenance_operations',
  'matter_inputs',
  'matter_mandates',
  'matters',
  'memory_curation_jobs',
  'memory_doc_events',
  'memory_doc_lines',
  'memory_doc_migration',
  'memory_docs',
  'memory_entries',
  'memory_entry_migrations',
  'memory_inferences',
  'message_attachments',
  'messages',
  'migration_checks',
  'money_accounts',
  'money_categories',
  'money_drafts',
  'money_entries',
  'network_identity',
  'network_tasks',
  'node_actions',
  'node_pairing_codes',
  'nodes',
  'note_folders',
  'note_versions',
  'notes',
  'notification_mail_status',
  'pairing_codes',
  'presence',
  'project_events',
  'project_items',
  'projects',
  'push_subscriptions',
  'receipts',
  'registrations',
  'reminders',
  'restore_previews',
  'return_briefs',
  'rule_events',
  'rules',
  'run_events',
  'runs',
  'said_log',
  'schema_migrations',
  'self_changes',
  'self_deploy_approvals',
  'self_jobs',
  'sessions',
  'sources',
  'subscriptions',
  'task_events',
  'task_feedback',
  'task_links',
  'task_runs',
  'task_schedules',
  'task_steps',
  'tasks',
  'telemetry_events',
  'telemetry_settings',
  'term_decodings',
  'tool_groups',
  'translate_settings',
  'translation_cache',
  'trigger_dispositions',
  'trigger_firings',
  'triggers',
  'versions',
  'visibility_marks',
];

const opened: Database[] = [];

function memory(): Database {
  const db = openDatabase(MEMORY_DATABASE);
  opened.push(db);
  return db;
}

function tables(db: Database): string[] {
  const rows = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map((row) => String(row['name']));
}

afterEach(() => {
  for (const db of opened.splice(0)) {
    db.close();
  }
});

test('新库跑完全部迁移，M0 到 M6 与自迭代要的表都在', () => {
  const db = memory();
  const applied = migrate(db, HISTORY, steppingClock());
  assert.deepEqual(applied, ALL_MIGRATIONS);
  assert.deepEqual(tables(db), TABLES_0058);
});

test('0024 的库只补跑后续迁移，启用核对数据保留且重复打开不重跑', () => {
  const db = memory();
  migrate(db, HISTORY.slice(0, 24), steppingClock());
  const payload = JSON.stringify({ status: 'passed', note: '已核对的功能' });
  db.run('INSERT INTO activation_features (id, payload) VALUES ($id, $payload)', { id: 'feature', payload });
  assert.equal(appliedMigrations(db).at(-1), '0024-activation');
  assert.deepEqual(migrate(db, HISTORY, steppingClock()),
    ['0025-self-code', '0026-feed-search', '0027-self-code-enabled', '0028-node-channel', '0029-task-origins',
      '0030-task-workchain', '0031-note-folders', '0032-cognition-work', '0033-systems-work',
      '0034-feed-comments', '0035-brief-disagreements', '0036-mail-fallback', '0037-books',
      '0038-projects', '0040-memory-docs', '0041-task-contracts', '0042-device-lanes',
      '0043-things', '0044-message-widgets', '0045-bookmarks', '0046-translations', '0047-contacts-network',
      '0048-own-notices', '0049-own-notice-twins',
      '0050-maintenance', '0051-feed-saves-apart', '0052-mail-bodies', '0053-reminder-notices',
      '0054-feed-sources-x', '0055-self-expectations', '0057-ask-basis', '0058-lines']);
  assert.equal(appliedMigrations(db).at(-1), '0058-lines');
  assert.deepEqual(tables(db), TABLES_0058);
  assert.equal(db.get('SELECT payload FROM activation_features WHERE id = $id', { id: 'feature' })?.['payload'],
    payload);
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), []);
});

test('旧库只补之后的功能迁移，词表不复制、不猜时间、不改确认状态', () => {
  const db = memory();
  migrate(db, HISTORY.slice(0, 13), steppingClock());
  for (const [id, tier] of [['known', 'analogy'], ['unknown', '自定义旧档']] as const) {
    const legacy = JSON.stringify({ row: { data: JSON.stringify({ tier, decodings: ['解读一', { text: '解读二' }] }) } });
    db.run(`INSERT INTO agreements (id, created_at, updated_at, version, kind, title, text, scope,
      premises, state, legacy_payload, migrated_default)
      VALUES ($id, 't', 't', 4, 'term', '词', '定义', '', '[]', 'under_review', $legacy, 1)`, { id, legacy });
  }
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), GAPS);
  assert.equal(db.get('SELECT term_tier FROM agreements WHERE id = $id', { id: 'known' })?.['term_tier'], 'metaphor');
  assert.equal(db.get('SELECT term_tier FROM agreements WHERE id = $id', { id: 'unknown' })?.['term_tier'], null);
  assert.equal(db.get('SELECT count(*) AS n FROM agreements')?.['n'], 2);
  assert.deepEqual(db.all('SELECT DISTINCT version, state FROM agreements').map((row) => ({ ...row })),
    [{ version: 4, state: 'under_review' }]);
  const decoded = db.get('SELECT count(*) AS n FROM term_decodings WHERE created_at IS NULL AND term_version IS NULL');
  assert.equal(decoded?.['n'], 4);
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), []);
  assert.equal(db.get('SELECT count(*) AS n FROM term_decodings')?.['n'], 4);
});

test('M0 的旧库打开时只补跑之后的迁移，旧数据还在', () => {
  const db = memory();
  migrate(db, HISTORY.slice(0, 3), steppingClock());
  db.run("INSERT INTO legacy_ids VALUES ('records.sqlite', 'guide_sections', 'g1', 'agreements', 'a1', 't')");
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), [
    '0004-app',
    '0005-notes',
    '0006-tasks-asks',
    '0007-task-history',
    '0008-memory-judgments',
    '0009-concerns-daily',
    '0010-trigger-generations',
    '0011-devices-self', ...M5B,
  ]);
  assert.equal(db.get('SELECT count(*) AS n FROM legacy_ids')?.['n'], 1);
});

test('M1 的库补跑 0006：已有任务拿到 M2 新列的默认值（未看过、没做完、不用换做法），行一条不少', () => {
  const db = memory();
  migrate(db, HISTORY.slice(0, 5), steppingClock());
  db.run(`INSERT INTO tasks (id, created_at, updated_at, version, title, origin, status, goal_version,
    acceptance, prohibitions, agreement_ids, plan_version, retry_budget, attempts_used, failure_signatures,
    signature_repeats, verifier_policy, results)
    VALUES ('t1', 't', 't', 1, '任务', 'user', 'queued', 1, '[]', '[]', '[]', 0, 3, 0, '[]', 0, 'brain', '[]')`);
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), [
    '0006-tasks-asks',
    '0007-task-history',
    '0008-memory-judgments',
    '0009-concerns-daily',
    '0010-trigger-generations',
    '0011-devices-self', ...M5B,
  ]);
  const columns = 'seen_at, finished_at, replan_required, original_request, archived_from, rework_count';
  const row = db.get(`SELECT ${columns} FROM tasks WHERE id = $id`, { id: 't1' });
  assert.deepEqual({ ...row }, {
    seen_at: null,
    finished_at: null,
    replan_required: 0,
    // No first version recorded for this hand-made row: the title is filled in, marked as such.
    original_request: '（回填，没有记下交办时的原话）任务',
    archived_from: null,
    rework_count: 0,
  });
});

test('0007 遇到旧格式动作标识的任务回执就整批失败、说清原因，库停在原版本；新格式的照常升级', () => {
  const insertTask = `INSERT INTO tasks (id, created_at, updated_at, version, title, origin, status, goal_version,
    acceptance, prohibitions, agreement_ids, plan_version, retry_budget, attempts_used, failure_signatures,
    signature_repeats, verifier_policy, results)
    VALUES ('t1', 't', 't', 1, '任务', 'user', 'running', 1, '[]', '[]', '[]', 0, 3, 0, '[]', 0, 'brain', '[]')`;
  const insertReceipt = `INSERT INTO receipts (action_id, created_at, updated_at, version, task_id, tool, args_digest,
    replay, effect, status) VALUES ($action_id, 't', 't', 1, 't1', 'send', 'd', 'once', 'external', 'succeeded')`;
  const cases = [
    ['t1:-:0:send:d', false],
    ['t1:-:0r1:send:d', false],
    // An old id whose tool name starts with g and a digit: the generation field is still the old attempt.
    ['t1:-:0:g1:d', false],
    ['t1:collect:g0:g1:d', true],
    ['t1:-:g0:send:d', true],
  ] as const;
  for (const [actionId, upgrades] of cases) {
    const db = memory();
    migrate(db, HISTORY.slice(0, 6), steppingClock());
    db.run(insertTask);
    db.run(insertReceipt, { action_id: String(actionId) });
    if (upgrades === true) {
      const upgraded = [
        '0007-task-history',
        '0008-memory-judgments',
        '0009-concerns-daily',
        '0010-trigger-generations',
        '0011-devices-self', ...M5B,
      ];
      assert.deepEqual(migrate(db, HISTORY, steppingClock()), upgraded);
      continue;
    }
    const error = throwsState(() => migrate(db, HISTORY, steppingClock()), 'migration_failed');
    assert.ok(error.cause instanceof Error);
    assert.match(error.cause.message, /库里有旧格式的任务回执_动作标识不兼容_要先人工核对/);
    assert.equal(appliedMigrations(db).includes('0007-task-history'), false);
    assert.equal(db.get('SELECT count(*) AS n FROM receipts')?.['n'], 1);
  }
});

test('M2 的库补跑 0008：已有判断不在讨论中，接口回执多出可空的请求体摘要，行一条不少', () => {
  const db = memory();
  migrate(db, HISTORY.slice(0, 7), steppingClock());
  db.run(`INSERT INTO judgments (id, created_at, updated_at, version, statement, explanation, verification, status)
    VALUES ('j1', 't', 't', 1, '命题', '解释', '{}', 'active')`);
  db.run(`INSERT INTO api_requests (request_id, scope, status, body, created_at, expires_at)
    VALUES ('r1', 'POST /v2/notes', 201, '{}', 't', 't')`);
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), [
    '0008-memory-judgments',
    '0009-concerns-daily',
    '0010-trigger-generations',
    '0011-devices-self', ...M5B,
  ]);
  assert.equal(db.get('SELECT discussing FROM judgments WHERE id = $id', { id: 'j1' })?.['discussing'], 0);
  const request = db.get('SELECT body_digest FROM api_requests WHERE request_id = $id', { id: 'r1' });
  assert.equal(request?.['body_digest'], null);
});

test('一个对象同时只能有一条没解决的分歧标记；同一个动作标识只能记一次', () => {
  const db = memory();
  migrate(db, HISTORY, steppingClock());
  const insert = `INSERT INTO disagreement_marks (id, created_at, updated_at, version, target_type, target_id,
    target_version, user_position, brain_position, user_basis, brain_basis, what_would_change_user,
    what_would_change_brain, user_sources, brain_sources, status)
    VALUES ($id, 't', 't', 1, 'judgment', 'j1', 1, 'u', 'b', 'ub', 'bb', 'wu', 'wb', '[]', '[]', $status)`;
  db.run(insert, { id: 'm1', status: 'open' });
  assert.throws(() => db.run(insert, { id: 'm2', status: 'open' }), /UNIQUE constraint failed/);
  db.run(insert, { id: 'm3', status: 'resolved' });
  const action = "INSERT INTO disagreement_actions VALUES ('a1', $mark, 't')";
  db.run(action, { mark: 'm1' });
  assert.throws(() => db.run(action, { mark: 'm3' }), /UNIQUE constraint failed/);
});

test('配对码的使用时间和设备只能同时有或同时没有', () => {
  const db = memory();
  migrate(db, HISTORY, steppingClock());
  const insert = `INSERT INTO pairing_codes (id, created_at, updated_at, version, code_hash, expires_at, used_at)
    VALUES ('p1', 't', 't', 1, 'h', 't', 't')`;
  assert.throws(() => db.run(insert), /CHECK constraint failed/);
});

test('迁移重跑是空操作：第二次不再执行任何迁移，表结构不变', async () => {
  const { directory, cleanup } = await tempDirectory();
  try {
    const path = `${directory}/plasticine.sqlite`;
    const first = openState({ path });
    assert.equal(first.newlyApplied.length, MIGRATIONS.length);
    first.close();
    const second = openState({ path });
    assert.deepEqual(second.newlyApplied, []);
    assert.deepEqual(second.schemaVersion(), [...ALL_MIGRATIONS, ...RETIRE, ...AFTER_RETIRE]);
    second.close();
  } finally {
    await cleanup();
  }
});

test('一批迁移里有一条失败，整批回滚：表和迁移记录都不留', () => {
  const db = memory();
  const broken: Migration = {
    id: '0002-broken',
    up(migrationDb) {
      migrationDb.exec('CREATE TABLE half_done (id TEXT)');
      migrationDb.exec('CREATE TABLE oops (');
    },
  };
  const first: Migration = { id: '0001-first', up: (migrationDb) => migrationDb.exec('CREATE TABLE first (id TEXT)') };
  const error = throwsState(() => migrate(db, [first, broken], steppingClock()), 'migration_failed');
  assert.match(error.message, /0002-broken/);
  assert.deepEqual(tables(db), ['schema_migrations']);
  assert.deepEqual(appliedMigrations(db), []);
});

test('迁移里写 DROP、RENAME、DELETE 或会隐式删行的 REPLACE 一律拒绝，库不变', () => {
  const statements = [
    'DROP TABLE tasks',
    'ALTER TABLE tasks RENAME COLUMN title TO name',
    'DELETE FROM tasks',
    "INSERT OR REPLACE INTO legacy_ids VALUES ('a', 'b', 'c', 'd', 'e', 'f')",
    "REPLACE INTO legacy_ids VALUES ('a', 'b', 'c', 'd', 'e', 'f')",
  ];
  for (const sql of statements) {
    const db = memory();
    migrate(db, HISTORY, steppingClock());
    const bad: Migration = { id: '0900-bad', up: (migrationDb) => migrationDb.exec(sql) };
    throwsState(() => migrate(db, [...HISTORY, bad], steppingClock()), 'forbidden_migration');
    assert.ok(tables(db).includes('tasks'));
    assert.equal(appliedMigrations(db).includes('0900-bad'), false);
  }
});

test('加列的迁移允许，之后旧数据还在', () => {
  const db = memory();
  migrate(db, HISTORY, steppingClock());
  const addColumn: Migration = {
    id: '0900-add-column',
    up: (migrationDb) => migrationDb.exec('ALTER TABLE tasks ADD COLUMN note TEXT'),
  };
  assert.deepEqual(migrate(db, [...HISTORY, addColumn], steppingClock()), ['0900-add-column']);
});

test('库里有代码不认识的迁移时拒绝打开，不猜', () => {
  const db = memory();
  migrate(db, HISTORY, steppingClock());
  throwsState(() => migrate(db, HISTORY.slice(0, 2), steppingClock()), 'migration_failed');
});

test('迁移编号不合格式或不递增时拒绝', () => {
  const db = memory();
  const noop = (id: string): Migration => ({ id, up: () => undefined });
  throwsState(() => migrate(db, [noop('first')], steppingClock()), 'migration_failed');
  throwsState(() => migrate(db, [noop('0002-b'), noop('0001-a')], steppingClock()), 'migration_failed');
});

test('任务状态的 CHECK 只接受十种状态，十种以外的值库直接拒绝', () => {
  const db = memory();
  migrate(db, HISTORY, steppingClock());
  const insert = `INSERT INTO tasks (id, created_at, updated_at, version, title, origin, status, goal_version,
    acceptance, prohibitions, agreement_ids, plan_version, retry_budget, attempts_used, failure_signatures,
    signature_repeats, verifier_policy, results)
    VALUES ($id, 't', 't', 1, '任务', 'user', $status, 1, '[]', '[]', '[]', 0, 3, 0, '[]', 0, 'brain', '[]')`;
  TASK_STATUSES.forEach((status, index) => {
    db.run(insert, { id: `task-${index}`, status });
  });
  for (const status of ['completed', 'needs_attention', '已交付', '']) {
    assert.throws(
      () => db.run(insert, { id: `bad-${status}`, status }),
      (error: unknown) => error instanceof Error && /CHECK constraint failed/.test(error.message),
    );
  }
  assert.equal(db.get('SELECT count(*) AS n FROM tasks')?.['n'], TASK_STATUSES.length);
});

test('迁移失败带着原因，原因里能看到 SQLite 的报错', () => {
  const db = memory();
  const broken: Migration = { id: '0001-broken', up: (migrationDb) => migrationDb.exec('CREATE TABLE (') };
  const error = throwsState(() => migrate(db, [broken], steppingClock()), 'migration_failed');
  assert.ok(error.cause instanceof Error);
  assert.ok(!(error.cause instanceof StateError));
});

test('M3 的库补跑 0009：已有关切、卡一条不少，新表都是空的', () => {
  const db = memory();
  migrate(db, HISTORY.slice(0, 8), steppingClock());
  db.run(`INSERT INTO concerns (id, created_at, updated_at, version, title, kind, why, initiator, lifecycle,
    activities, wait_conditions, trigger_conditions, channel, agreement_ids)
    VALUES ('c1', 't', 't', 1, '关切', 'goal', '为什么', 'user', 'active', '[]', '[]', '[]', 'next_report', '[]')`);
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), [
    '0009-concerns-daily', '0010-trigger-generations', '0011-devices-self', ...M5B,
  ]);
  assert.equal(db.get('SELECT count(*) AS n FROM concerns')?.['n'], 1);
  for (const table of ['registrations', 'feed_items', 'brief_items', 'return_briefs', 'trigger_firings']) {
    assert.equal(db.get(`SELECT count(*) AS n FROM ${table}`)?.['n'], 0, table);
  }
});

test('M4 的库补跑 0010：旧触发的标识和内容保留，补为第一代，代次不能重复', () => {
  const db = memory();
  migrate(db, HISTORY.slice(0, 9), steppingClock());
  db.run(`INSERT INTO trigger_firings (key, kind, ref_type, ref_id, channel, outcome, fired_at)
    VALUES ('deadline:j1', 'deadline', 'judgment', 'j1', 'silent', 'silent', '2026-10-27T00:00:00.000Z')`);
  const before = db.get('SELECT * FROM trigger_firings');
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), [
    '0010-trigger-generations', '0011-devices-self', ...M5B,
  ]);
  const after = db.get('SELECT * FROM trigger_firings');
  assert.deepEqual({ ...after }, { ...before, trigger_key: 'deadline:j1', generation: 1, invalidated_at: null });
  const insert = `INSERT INTO trigger_firings
    (key, kind, ref_type, ref_id, channel, outcome, fired_at, trigger_key, generation)
    VALUES ($key, 'deadline', 'judgment', 'j1', 'silent', 'silent',
      '2026-10-27T00:00:00.000Z', 'deadline:j1', $generation)`;
  assert.throws(() => db.run(insert, { key: 'different-key', generation: 1 }), /UNIQUE constraint failed/);
  db.run(insert, { key: 'deadline:j1:generation:2', generation: 2 });
  assert.equal(db.get('SELECT count(*) AS n FROM trigger_firings')?.['n'], 2);
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), []);
});

test('0009 的约束：一次离开只有一份四句话、同一触发只记一次、同一来源的登记只算一次', () => {
  const db = memory();
  migrate(db, HISTORY, steppingClock());
  const brief = `INSERT INTO return_briefs (id, created_at, updated_at, version, away_since, returned_at, away_ms,
    status, sentences) VALUES ($id, 't', 't', 1, '2026-10-27T00:00:00.000Z', 't', 1, 'ready', '[]')`;
  db.run(brief, { id: 'b1' });
  assert.throws(() => db.run(brief, { id: 'b2' }), /UNIQUE constraint failed/);
  const firing = `INSERT INTO trigger_firings (key, kind, ref_type, ref_id, channel, outcome, fired_at)
    VALUES ('deadline:j1', 'deadline', 'judgment', 'j1', 'popup', 'card', 't')`;
  db.run(firing);
  assert.throws(() => db.run(firing), /UNIQUE constraint failed/);
  db.run(`INSERT INTO concerns (id, created_at, updated_at, version, title, kind, why, initiator, lifecycle,
    activities, wait_conditions, trigger_conditions, channel, agreement_ids)
    VALUES ('c1', 't', 't', 1, '登记', 'goal', '为什么', 'user', 'active', '[]', '[]', '[]', 'next_report', '[]')`);
  const registration = `INSERT INTO registrations (id, created_at, updated_at, version, concern_id, criterion_id,
    kind, label, occurred_at, source_ref) VALUES ($id, 't', 't', 1, 'c1', 'k', 'signup', '甲', 't', 'm-1')`;
  db.run(registration, { id: 'r1' });
  assert.throws(() => db.run(registration, { id: 'r2' }), /UNIQUE constraint failed/);
  assert.throws(
    () => db.run(`INSERT INTO feed_items (id, created_at, updated_at, version, source_id, origin, title, summary, why,
      dedupe_key, day, arrived_at, reaction) VALUES ('f1', 't', 't', 1, 's', 'manual', 't', '', '', 'k', 'd', 't',
      'love')`),
    /constraint failed/,
  );
});

test('M4 的库补跑 0011：已有任务一条不少，节点、配对码、设备动作和自迭代记录都是空的', () => {
  const db = memory();
  migrate(db, HISTORY.slice(0, 10), steppingClock());
  db.run(`INSERT INTO tasks (id, created_at, updated_at, version, title, origin, status, goal_version,
    acceptance, prohibitions, agreement_ids, plan_version, retry_budget, attempts_used, failure_signatures,
    signature_repeats, verifier_policy, results)
    VALUES ('t1', 't', 't', 1, '任务', 'user', 'queued', 1, '[]', '[]', '[]', 0, 3, 0, '[]', 0, 'brain', '[]')`);
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), ['0011-devices-self', ...M5B]);
  assert.equal(db.get('SELECT count(*) AS n FROM tasks')?.['n'], 1);
  for (const table of ['nodes', 'node_pairing_codes', 'node_actions', 'self_changes']) {
    assert.equal(db.get(`SELECT count(*) AS n FROM ${table}`)?.['n'], 0, table);
  }
});

test('0011 的约束：同一个设备动作标识只记一行，节点凭证散列不重复，配对码用过就带着节点', () => {
  const db = memory();
  migrate(db, HISTORY, steppingClock());
  const action = `INSERT INTO node_actions (id, created_at, updated_at, version, action_id, node_id, kind,
    action_class, target, params_digest, status, origin, requested_at)
    VALUES ($id, 't', 't', 1, 'a1', 'n1', 'file_read', 'read', '~/x', 'd', 'sent', 'brain', 't')`;
  db.run(action, { id: 'r1' });
  assert.throws(() => db.run(action, { id: 'r2' }), /UNIQUE constraint failed/);
  const node = `INSERT INTO nodes (id, created_at, updated_at, version, name, platform, app_version,
    protocol_version, capabilities, credential_hash, pairing_code_id, paired_at, last_seen_at)
    VALUES ($id, 't', 't', 1, 'Mac', 'macos', '1', 1, '[]', 'h', 'c', 't', 't')`;
  db.run(node, { id: 'n1' });
  assert.throws(() => db.run(node, { id: 'n2' }), /UNIQUE constraint failed/);
  db.run(`INSERT INTO devices (id, created_at, updated_at, version, name, first_seen_at, last_seen_at)
    VALUES ('d1', 't', 't', 1, '手机', 't', 't')`);
  const code = `INSERT INTO node_pairing_codes (id, created_at, updated_at, version, code_hash, expires_at,
    issued_by_device_id, used_at) VALUES ('p1', 't', 't', 1, 'h', 't', 'd1', 't')`;
  assert.throws(() => db.run(code), /CHECK constraint failed/);
});

test('M5 甲路升级补后续迁移，已有节点不变，生活、站内信和成果表从空表开始', () => {
  const db = memory();
  migrate(db, HISTORY.slice(0, 11), steppingClock());
  db.run(`INSERT INTO nodes (id, created_at, updated_at, version, name, platform, app_version,
    protocol_version, capabilities, credential_hash, pairing_code_id, paired_at, last_seen_at)
    VALUES ('n1', 't', 't', 1, 'Mac', 'macos', '1', 1, '[]', 'h', 'c', 't', 't')`);
  const before = db.get('SELECT * FROM nodes');
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), M5B);
  // 0040 只给节点加两列可空的空闲上报，原有各列不变。
  assert.deepEqual({ ...db.get('SELECT * FROM nodes') }, { ...before, idle_seconds: null, idle_reported_at: null });
  for (const table of ['money_entries', 'focus_sessions', 'inbox_messages', 'artifacts']) {
    assert.equal(db.get(`SELECT count(*) AS n FROM ${table}`)?.['n'], 0, table);
  }
});

test('已有阅读来源和条目前向转为手动信息，保留内容、关联、反应和迁移原文，重跑不变', () => {
  const db = memory();
  migrate(db, HISTORY.filter((item) => item.id < '0013'), steppingClock());
  db.run(`INSERT INTO feed_sources (id, created_at, updated_at, version, kind, label, query, level, ref,
    migrated_default, legacy_payload) VALUES
    ('reading', 't', 't', 3, 'reading', '旧阅读来源', '原来的查询', 'less', 'reading:old', 1, '{"keep":true}')`);
  db.run(`INSERT INTO feed_items (id, created_at, updated_at, version, source_id, origin, title, url, summary,
    why, dedupe_key, day, arrived_at, reaction, saved_at, note, seen_at, migrated_default, legacy_payload) VALUES
    ('article', 't', 't', 4, 'reading', 'reading', '旧文章', 'https://example.test/article', '完整正文',
    '之前收录', 'reading:item', '2026-10-28', 't', 'like', 't', '我的批注', 't', 1, '{"keep":"article"}')`);
  const source = db.get('SELECT * FROM feed_sources');
  const item = db.get('SELECT * FROM feed_items');
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), ['0013-reading-to-manual', ...GAPS]);
  assert.deepEqual({ ...db.get('SELECT * FROM feed_sources') }, { ...source, kind: 'internal', query_edited: 0 });
  assert.deepEqual({ ...db.get('SELECT * FROM feed_items') }, { ...item, origin: 'manual', reaction_at: 't',
    author: null, author_handle: null, avatar_url: null, image_url: null, image_ratio: null });
  assert.deepEqual(migrate(db, HISTORY, steppingClock()), []);
  assert.equal(db.get('SELECT count(*) AS n FROM feed_sources')?.['n'], 1);
  assert.equal(db.get('SELECT count(*) AS n FROM feed_items')?.['n'], 1);
});

test('0063：线的消息加一列 meta（JSON，可空），旧行是空的，不是合法 JSON 的写不进去', () => {
  const db = memory();
  migrate(db, MIGRATIONS.filter((entry) => entry.id < '0063'), () => '2026-11-05T00:00:00Z');
  db.exec(`INSERT INTO lines (id, created_at, updated_at, kind, title, status)
    VALUES ('l1', '2026-11-05T00:00:00Z', '2026-11-05T00:00:00Z', 'background', '旧线', 'idle')`);
  db.exec(`INSERT INTO line_messages (line_id, seq, role, message, created_at)
    VALUES ('l1', 1, 'user', '{}', '2026-11-05T00:00:00Z')`);
  migrate(db, MIGRATIONS, () => '2026-11-05T00:00:00Z');
  assert.equal(db.get('SELECT meta FROM line_messages WHERE seq = 1')?.['meta'], null);
  assert.throws(() => db.exec(`INSERT INTO line_messages (line_id, seq, role, message, meta, created_at)
    VALUES ('l1', 2, 'user', '{}', 'not json', '2026-11-05T00:00:00Z')`));
});

test('0064：旧线、旧联系人加列后是空的；群、群消息、群任务、替人答的线各一张表，群里同一条消息只记一次', () => {
  const db = memory();
  const at = '2026-11-05T00:00:00Z';
  migrate(db, MIGRATIONS.filter((entry) => entry.id < '0064'), () => at);
  db.exec(`INSERT INTO lines (id, created_at, updated_at, kind, title, status)
    VALUES ('l1', '${at}', '${at}', 'background', '旧线', 'idle')`);
  migrate(db, MIGRATIONS, () => at);
  assert.equal(db.get("SELECT sealed_prompt FROM lines WHERE id = 'l1'")?.['sealed_prompt'], null);
  db.exec(`INSERT INTO net_groups (id, created_at, updated_at, version, owner_account_id, name, last_at)
    VALUES ('g1', '${at}', '${at}', 1, 'acct-alex', '杭州周末', '${at}')`);
  const message = `INSERT INTO group_messages (id, created_at, updated_at, version, group_id, message_id,
    author_account_id, author, kind, text, sent_at) VALUES ($id, '${at}', '${at}', 1, 'g1', 'm1', 'acct-alex', 'me',
    'text', '周六见', '${at}')`;
  db.run(message, { id: 'gm1' });
  assert.throws(() => db.run(message, { id: 'gm2' }));
  assert.throws(() => db.exec(`INSERT INTO net_responses (id, created_at, updated_at, version, line_id, origin, mode,
    question_id, exchange_id, materials, status) VALUES ('r1', '${at}', '${at}', 1, 'l1', 'contact', 'answer', 'q1',
    'x1', 'not json', 'running')`));
});
