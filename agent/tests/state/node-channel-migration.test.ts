import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DEVICE_LIMITS } from '../../src/devices/index.ts';
import { openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS as EVERY_MIGRATION } from '../../src/state/migrations/index.ts';
import { steppingClock } from './helpers.ts';

// 讲的是 0058 之前的历史：只跑到 0058（0059 起的清理在 retire-migration.test.ts）。
const MIGRATIONS = EVERY_MIGRATION.filter((entry) => entry.id < '0059');

test('线上默认已是五类 allow、删除逐次确认；升级不改默认行或用户改过的上限与确认', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db, MIGRATIONS.filter((migration) => migration.id < '0028'), steppingClock());
    assert.deepEqual(Object.fromEntries(Object.entries(DEFAULT_DEVICE_LIMITS.classes)
      .map(([key, value]) => [key, value.mode])),
    { read: 'allow', write: 'allow', delete: 'confirm_each', command: 'allow', browser: 'allow', input: 'allow' });
    const customized = { ...DEFAULT_DEVICE_LIMITS, roots: ['~/Work'],
      classes: { ...DEFAULT_DEVICE_LIMITS.classes, command: { mode: 'deny', perHour: 3 } } };
    for (const [id, limits] of [['default', DEFAULT_DEVICE_LIMITS], ['custom', customized]] as const) {
      db.run(`INSERT INTO nodes (id, created_at, updated_at, version, name, platform, app_version,
        protocol_version, capabilities, credential_hash, pairing_code_id, paired_at, last_seen_at,
        limits, limits_version, confirmed_by_device_id, confirmed_by_device_at)
        VALUES ($id, 't', 't', 5, 'Mac', 'macos', '1', 1, '[]', $id, 'test', 't', 't', $limits, 2, 'test', 't')`,
      { id, limits: JSON.stringify(limits) });
    }
    const before = db.all('SELECT * FROM nodes ORDER BY id');
    assert.deepEqual(migrate(db, MIGRATIONS, steppingClock()),
      ['0028-node-channel', '0029-task-origins', '0030-task-workchain', '0031-note-folders',
        '0032-cognition-work', '0033-systems-work', '0034-feed-comments', '0035-brief-disagreements',
        '0036-mail-fallback', '0037-books', '0038-projects', '0040-memory-docs', '0041-task-contracts', '0042-device-lanes',
      '0043-things', '0044-message-widgets', '0045-bookmarks', '0046-translations', '0047-contacts-network',
      '0048-own-notices', '0049-own-notice-twins',
      '0050-maintenance', '0051-feed-saves-apart', '0052-mail-bodies', '0053-reminder-notices',
      '0054-feed-sources-x', '0055-self-expectations', '0057-ask-basis', '0058-lines']);
    // 0040 只给节点加两列可空的空闲上报，原有各列不变。
    assert.deepEqual(db.all('SELECT * FROM nodes ORDER BY id').map((row) => ({ ...row })),
      before.map((row) => ({ ...row, idle_seconds: null, idle_reported_at: null })));
    assert.deepEqual(migrate(db, MIGRATIONS, steppingClock()), []);
  } finally { db.close(); }
});
