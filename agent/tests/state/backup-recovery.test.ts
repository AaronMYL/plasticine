import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openState, prepareOfflineRestore } from '../../src/state/index.ts';
import { createHash, randomUUID } from 'node:crypto';
test('整库恢复写到全新隔离目录，保留当前快照，重放删除并阻止直接开机运行旧任务', () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-offline-'));
  const stateDirectory = join(directory, 'state');
  let state: ReturnType<typeof openState> | undefined;
  try {
    state = openState({ path: join(directory, 'plasticine.sqlite') });
    const old = state.notes.create({ markdown: '随后删除', author: 'user', folder: '笔记' });
    const at = '2026-10-28T00:00:00Z';
    const device = state.devices.create({ name: '测试设备', firstSeenAt: at, lastSeenAt: at });
    const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
    const session = state.sessions.create({
      deviceId: device.id,
      tokenHash,
      lastSeenAt: at,
      expiresAt: '2027-10-28T00:00:00Z',
    });
    const backup = state.backups.begin('offline-backup-001', 'manual');
    state.backups.complete(backup.id);
    state.notes.markDeleted(old.id);
    const newer = state.notes.create({ markdown: '备份之后新增', author: 'user', folder: '笔记' });
    state.close();
    state = undefined;
    const result = prepareOfflineRestore({
      stateDirectory: directory,
      backupId: backup.id,
      destination: stateDirectory,
    });
    assert.equal(existsSync(join(result.restoredDirectory, 'restore-review.json')), true);
    const restored = new DatabaseSync(join(result.restoredDirectory, 'plasticine.sqlite'), { readOnly: true });
    const safety = new DatabaseSync(join(result.safetyDirectory, 'plasticine.sqlite'), { readOnly: true });
    try {
      assert.ok(restored.prepare('SELECT deleted_at FROM notes WHERE id = ?').get(old.id)?.['deleted_at']);
      assert.equal(safety.prepare('SELECT COUNT(*) AS n FROM notes WHERE id = ?').get(newer.id)?.['n'], 1);
      const invalidated = restored.prepare('SELECT revoked_at, token_hash FROM sessions WHERE id = ?').get(session.id);
      assert.ok(invalidated?.['revoked_at']);
      assert.notEqual(invalidated?.['token_hash'], tokenHash);
      const originalSession = safety.prepare('SELECT revoked_at FROM sessions WHERE id = ?').get(session.id);
      assert.equal(originalSession?.['revoked_at'], null);
    } finally {
      restored.close();
      safety.close();
    }
    assert.ok(readFileSync(join(result.restoredDirectory, 'restore-review.json'), 'utf8').includes(newer.id));
    assert.throws(
      () => prepareOfflineRestore({ stateDirectory: directory, backupId: backup.id, destination: stateDirectory }),
      /已存在/,
    );
  } finally {
    state?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
