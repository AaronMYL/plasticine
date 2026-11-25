import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

const ID = '0147-retired-tables-action-indexes';
const UP_TO = MIGRATIONS.filter((entry) => entry.id <= ID);
const RETIRED = [
  'trigger_dispositions', 'triggers', 'intake_sources', 'rule_events', 'rules',
  'pairing_codes', 'mail_fallback_settings', 'notification_mail_status', 'client_updates',
];
const META = "'2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 1";

function names(db: ReturnType<typeof openDatabase>, type: 'table' | 'index'): string[] {
  return db.all('SELECT name FROM sqlite_schema WHERE type = $type ORDER BY name', { type })
    .map((row) => String(row['name']));
}

test('0147 drops 9 retired tables and 3 iPhone actions, adds 2 device_action indexes', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const clock = (): string => '2026-11-17T00:00:00.000Z';
    migrate(db, MIGRATIONS.filter((entry) => entry.id < ID), clock);
    const before = names(db, 'table');
    for (const table of RETIRED) {
      assert.equal(before.includes(table), true, table);
    }
    db.run(`INSERT INTO intake_sources (id, created_at, updated_at, version, kind, label, config)
      VALUES ('s1', ${META}, 'mail', '邮件', '{}')`);
    db.run(`INSERT INTO triggers (id, source_id, kind, external_key, thread_keys, actor, actor_source_kind,
      occurred_at, received_at, ref_type, summary, facts)
      VALUES ('t1', 's1', 'mail', 'k1', '[]', 'someone', 'mail', 't', 't', 'inbox_message', '一封信', '{}')`);
    db.run(`INSERT INTO trigger_dispositions (id, trigger_id, kind, actor, at)
      VALUES ('d1', 't1', 'ignored', 'system', 't')`);
    db.run(`INSERT INTO triggers (id, source_id, kind, external_key, thread_keys, actor, actor_source_kind,
      occurred_at, received_at, ref_type, ref_id, summary, facts)
      VALUES ('t2', 's1', 'feed.interest_hit', 'k2', '[]', 'system', 'feed', 't', 't', 'feed_item', 'f1', '一条', '{}')`);
    db.run("UPDATE triggers SET ref_id = 'm1' WHERE id = 't1'");
    db.run("INSERT INTO client_publications (id, metadata) VALUES ('p1', '{}')");
    const action = (id: string, kind: string): void => {
      db.run(`INSERT INTO node_actions (id, created_at, updated_at, version, action_id, node_id, kind, action_class,
        target, params_digest, status, origin, requested_at)
        VALUES ($id, ${META}, $id, 'n1', $kind, 'read', '目标', 'digest', 'executed', 'line', 't')`, { id, kind });
    };
    action('a1', 'photo_list');
    action('a2', 'photo_read');
    action('a3', 'location_current');
    action('a4', 'calendar_list');
    action('a5', 'tab_read');
    const seen = ['mail:t1', 'waiting:line:l1', 'feed:t2', 'mail:gone', 'stuck:l2'];
    db.run(`INSERT INTO timed_slots (id, created_at, updated_at, version, source, config, memo)
      VALUES ('heartbeat', ${META}, 'heartbeat', '{}', $memo)`, { memo: JSON.stringify({ seen, other: 1 }) });
    db.run(`INSERT INTO timed_slots (id, created_at, updated_at, version, source, config, memo)
      VALUES ('dream', ${META}, 'dream', '{}', '{"last":"x"}')`);

    assert.deepEqual(migrate(db, UP_TO, clock), [ID]);

    const after = names(db, 'table');
    assert.deepEqual(after, before.filter((table) => !RETIRED.includes(table)));
    assert.equal(db.get('SELECT count(*) AS n FROM client_publications')?.['n'], 1);
    assert.deepEqual(db.all('SELECT id FROM node_actions ORDER BY id').map((row) => row['id']), ['a4', 'a5']);
    const memo = JSON.parse(String(db.get("SELECT memo FROM timed_slots WHERE id = 'heartbeat'")?.['memo'])) as
      { seen: string[]; other: number };
    assert.deepEqual(memo.seen, ['mail:m1', 'waiting:line:l1', 'feed:f1', 'mail:gone', 'stuck:l2']);
    assert.equal(memo.other, 1);
    assert.equal(db.get("SELECT memo FROM timed_slots WHERE id = 'dream'")?.['memo'], '{"last":"x"}');
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
    const indexes = names(db, 'index');
    assert.equal(indexes.includes('node_actions_requested'), true);
    assert.equal(indexes.includes('node_actions_run_node'), true);
    assert.deepEqual(migrate(db, UP_TO, clock), []);
  } finally {
    db.close();
  }
});

test('After 0147 recent-actions and line-device queries use index without table sort', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    migrate(db, MIGRATIONS, () => '2026-11-17T00:00:00.000Z');
    const plan = (sql: string): string => db.all(`EXPLAIN QUERY PLAN ${sql}`)
      .map((row) => String(row['detail'])).join(' | ');
    const recent = plan('SELECT id FROM node_actions ORDER BY requested_at DESC, id DESC LIMIT 50');
    assert.match(recent, /node_actions_requested/);
    assert.doesNotMatch(recent, /TEMP B-TREE/);
    const byRun = plan("SELECT id FROM node_actions WHERE run_id = 'line:1' AND node_id = 'n1' " +
      'ORDER BY requested_at DESC, rowid DESC LIMIT 50');
    assert.match(byRun, /node_actions_run_node/);
    const trim = plan("SELECT id FROM node_actions WHERE requested_at < '2026-10-01' AND result IS NOT NULL LIMIT 500");
    assert.match(trim, /node_actions_requested/);
  } finally {
    db.close();
  }
});
