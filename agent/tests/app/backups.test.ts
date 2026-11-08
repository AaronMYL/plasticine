import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { call, json, pair, startTestApp } from './helpers.ts';
import { newDeviceKey, registerKey, signedCall } from './signing.ts';
import { brainChange } from '../state/helpers.ts';

test('备份无下载旁路；本人老会话无钥匙按预览恢复，重试只新增一版且先留安全快照', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    app.clock.advance(20 * 60_000);
    const note = app.state.notes.create({ markdown: '备份前内容', author: 'user', folder: '笔记' });
    const response = await call(app, 'POST', '/v2/backups', { cookie, body: { requestId: 'backup-app-create' } });
    assert.equal(response.status, 202);
    const backupId = String(json(response)['id']);
    const detail = json(await call(app, 'GET', `/v2/backups/${backupId}`, { cookie }));
    assert.equal(detail['valid'], true);
    const metadata = detail['backup'] as { objectCount: number };
    assert.ok(metadata.objectCount >= 1);
    assert.equal((await call(app, 'GET', `/v2/backups/${backupId}/content`, { cookie })).status, 404);
    app.state.notes.save(note.id, note.version, { markdown: '后来新写的内容' });
    const preview = json(
      await call(app, 'POST', `/v2/backups/${backupId}/restore-preview`, {
        cookie,
        body: { requestId: 'backup-app-preview', kind: 'note', objectId: note.id },
      }),
    );
    assert.equal(preview['before'], '后来新写的内容');
    assert.equal(preview['after'], '备份前内容');
    assert.equal(preview['objectLabel'], '备份前内容');
    assert.equal(typeof preview['backupCreatedAt'], 'string');
    assert.equal(
      (
        await call(app, 'POST', `/v2/asks/${preview['askId']}/answer`, {
          cookie,
          body: { requestId: 'backup-answer-bypass', optionId: 'restore' },
        })
      ).status,
      403,
    );
    const body = {
      requestId: 'backup-app-restore',
      previewId: preview['id'],
      digest: preview['digest'],
      backupName: preview['backupName'],
      askVersion: preview['askVersion'],
    };
    const path = `/v2/backups/${backupId}/restore`;
    assert.equal(
      (await call(app, 'POST', path, { cookie, body: { ...body, backupName: '错误名称' } })).status,
      409,
    );
    const restored = await call(app, 'POST', path, { cookie, body });
    assert.equal(restored.status, 200);
    assert.equal(json(restored)['status'], 'restored');
    const safety = app.state.backups.require(String(json(restored)['safetyBackupId']));
    assert.equal(safety.status, 'ready');
    assert.equal(app.state.notes.require(note.id).version, 3);
    assert.equal(app.state.notes.readBody(app.state.notes.require(note.id)), '备份前内容');
    app.clock.advance(25 * 60 * 60 * 1000);
    assert.equal((await call(app, 'POST', path, { cookie, body })).status, 200);
    assert.equal(app.state.notes.require(note.id).version, 3);
  } finally {
    await app.close();
  }
});

test('恢复提交后广播对象的新版本，拒绝恢复和重放不再广播', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const key = newDeviceKey();
    await registerKey(app, cookie, key);
    const note = app.state.notes.create({ markdown: '原笔记', author: 'user', folder: '笔记' });
    const memory = app.state.memory.create({ kind: 'interpretation', text: '原解释', basis: 'inferred',
      sourceId: 'source-own-reasoning', provenance: '推理' }, brainChange());
    const backup = app.state.backups.begin('events-backup', 'manual');
    app.state.backups.complete(backup.id);
    app.state.notes.save(note.id, 1, { markdown: '新笔记' });
    app.state.memory.update(memory.id, 1, { text: '新解释' }, brainChange());
    for (const [kind, id, eventType] of [
      ['note', note.id, 'note_invalidated'], ['memory_entry', memory.id, 'memory_entry_changed'],
    ] as const) {
      const preview = json(await call(app, 'POST', `/v2/backups/${backup.id}/restore-preview`, {
        cookie, body: { requestId: `event-preview-${kind}`, kind, objectId: id },
      }));
      const calls: unknown[] = [];
      const publish = app.app.deps.hub.publish.bind(app.app.deps.hub);
      app.app.deps.hub.publish = (event) => {
        if (event.type === eventType) {
          calls.push(event);
          assert.equal(app.state.backups.getPreview(String(preview['id'])).status, 'restored');
        }
        return publish(event);
      };
      const body = { requestId: `event-restore-${kind}`, previewId: preview['id'], digest: preview['digest'],
        backupName: preview['backupName'], askVersion: preview['askVersion'] };
      const path = `/v2/backups/${backup.id}/restore`;
      const rejected = await signedCall(app, 'POST', path, { ...body, digest: '0'.repeat(64) }, { cookie, key });
      assert.equal(rejected.status, 409);
      assert.equal(calls.length, 0);
      assert.equal((await signedCall(app, 'POST', path, body, { cookie, key })).status, 200);
      assert.equal(calls.length, 1);
      assert.equal((await signedCall(app, 'POST', path, body, { cookie, key })).status, 200);
      assert.equal(calls.length, 1);
      app.app.deps.hub.publish = publish;
    }
  } finally {
    await app.close();
  }
});

test('当前正文丢失仍可恢复：先保留标有缺口的当前快照，再从完整备份新增正文', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const key = newDeviceKey();
    await registerKey(app, cookie, key);
    const note = app.state.notes.create({ markdown: '可恢复的正文', author: 'user', folder: '笔记' });
    const backup = app.state.backups.begin('backup-missing-source', 'manual');
    app.state.backups.complete(backup.id);
    rmSync(join(app.directory, 'notes', note.bodyFile));
    const preview = json(
      await call(app, 'POST', `/v2/backups/${backup.id}/restore-preview`, {
        cookie,
        body: { requestId: 'preview-missing-current', kind: 'note', objectId: note.id },
      }),
    );
    const restored = await signedCall(
      app,
      'POST',
      `/v2/backups/${backup.id}/restore`,
      {
        requestId: 'restore-missing-current',
        previewId: preview['id'],
        digest: preview['digest'],
        backupName: preview['backupName'],
        askVersion: preview['askVersion'],
      },
      { cookie, key },
    );
    assert.equal(restored.status, 200);
    assert.equal(app.state.notes.readBody(app.state.notes.require(note.id)), '可恢复的正文');
    assert.equal(app.state.backups.require(String(json(restored)['safetyBackupId'])).status, 'partial');
  } finally {
    await app.close();
  }
});

test('每日备份同日只一份；私密笔记备份标题与预览直接可读', async () => {
  const app = await startTestApp([], { automaticBackups: true });
  try {
    const cookie = await pair(app);
    app.app.deps.backups.scan();
    app.app.deps.backups.scan();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(app.state.backups.list().filter((row) => row.reason === 'daily').length, 1);
    const note = app.state.notes.create({ markdown: '私密内容', author: 'user', folder: '笔记', private: true });
    const backup = app.state.backups.begin('backup-private-001', 'manual');
    app.state.backups.complete(backup.id);
    const response = await call(app, 'POST', `/v2/backups/${backup.id}/restore-preview`, {
      cookie,
      body: { requestId: 'backup-private-preview', kind: 'note', objectId: note.id },
    });
    assert.equal(response.status, 200);
    assert.equal(json(response)['after'], '私密内容');
    assert.equal(json(response)['private'], true);
    const detail = json(await call(app, 'GET', `/v2/backups/${backup.id}`, { cookie }));
    const item = (detail['objects'] as { id: string; label: string; private: boolean }[])
      .find((row) => row.id === note.id)!;
    assert.equal(item.label, '私密内容');
    assert.equal(item.private, true);
    const read = await call(app, 'GET', `/v2/restore-previews/${String(json(response)['id'])}`, { cookie });
    assert.equal(read.status, 200);
    assert.equal(json(read)['after'], '私密内容');
  } finally {
    await app.close();
  }
});
