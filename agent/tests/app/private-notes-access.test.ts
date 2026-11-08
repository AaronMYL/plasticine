import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BrowserSessions } from '../../src/app/browser-sessions.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
let user: string;
let system: ReturnType<BrowserSessions['open']>;
let readers: string[];
beforeEach(async () => {
  t = await startTestApp([], { startTasks: false });
  user = await pair(t);
  system = new BrowserSessions(t.state, t.clock.now).open();
  readers = [user, system.cookie.split(';')[0]!];
  t.clock.advance(20 * 60_000);
});
afterEach(async () => { await t.close(); });

test('本人和系统浏览器直接读取私密正文、历史图片与全局全文查找，读取不改历史或来源', async () => {
  const asset = t.state.notes.writeAsset(Buffer.from('historical private image'), 'image/png');
  const path = `/v2/notes/assets/${asset.name}`;
  const original = t.state.notes.create({ markdown: `# 阅读随记\n![图片](${path})`,
    folder: '笔记', author: 'user', private: true });
  const markdown = '# 阅读随记\n' + '前文'.repeat(150) + '独有搜索词';
  const current = t.state.notes.save(original.id, 1, { markdown });
  const versions = t.state.notes.versions(original.id);
  for (const cookie of readers) {
    const read = await call(t, 'GET', `/v2/notes/${original.id}`, { cookie });
    assert.equal(read.status, 200);
    assert.equal(json(read)['markdown'], markdown);
    assert.equal(json(read)['private'], true);
    assert.equal(json(read)['readOnly'], false);
    const history = await call(t, 'GET', `/v2/notes/${original.id}/versions`, { cookie });
    assert.equal(history.status, 200);
    assert.equal((json(history)['versions'] as unknown[]).length, 2);
    const old = await call(t, 'GET', `/v2/notes/${original.id}/versions/1`, { cookie });
    assert.equal(old.status, 200);
    assert.equal(json(old)['markdown'], t.state.notes.readBody(original));
    const image = await call(t, 'GET', path, { cookie });
    assert.equal(image.status, 200);
    assert.equal(Buffer.from(image.body as ArrayBuffer).toString(), 'historical private image');
    const search = await call(t, 'GET', '/v2/search?q=独有搜索词&type=notes', { cookie });
    assert.equal(search.status, 200);
    const matches = json(search)['results'] as { id: string; title: string; excerpt: string }[];
    assert.equal(matches[0]?.id, original.id);
    assert.equal(matches[0]?.title, '阅读随记');
    assert.match(matches[0]?.excerpt ?? '', /独有搜索词/);
  }
  assert.deepEqual(t.state.notes.require(original.id), current);
  assert.deepEqual(t.state.notes.versions(original.id), versions);
  assert.equal(json(await call(t, 'GET', '/v2/session', { cookie: readers[1]! }))['actor'], 'system');
});

test('私密导入来源和原话出处可直接读，已合并原版的真正只读属性仍保留', async () => {
  const merged = t.state.notes.create({ markdown: '# 合并结果\n合并正文', folder: '笔记',
    author: 'ai', private: true }, { legacyPayload: { note: { merges: [{ fromId: 'old-original' }] } } });
  const original = t.state.notes.create({ markdown: '# 导入原版\n原文正文', folder: '已合并（原版）',
    author: 'user', private: true, readOnly: true }, { legacyPayload: { note: {
      versions: { import: 1, proofread: 2 }, history: [
        { revision: 1, markdown: '导入原文' }, { revision: 2, markdown: '校对原文' },
      ], mergedInto: { id: 'old-result' },
    } } });
  for (const [legacyId, targetId] of [['old-original', original.id], ['old-result', merged.id]]) {
    t.state.legacyIds.record({ sourceDb: 'files/notes', sourceTable: 'note-json', legacyId: legacyId!,
      targetTable: 'notes', targetId: targetId! });
  }
  const quote = '引用这篇原文';
  const change = { actor: 'user' as const, reason: '隔离来源测试' };
  const entry = t.state.memory.create({ kind: 'quote', basis: 'self_reported', text: quote,
    sourceId: 'source-user-said', provenance: '笔记原文', anchor: { kind: 'note', ref: original.id } }, change);
  const agreement = t.state.agreements.create({ kind: 'collaboration', text: '保留原文', scope: '共同讨论',
    userQuote: quote, quotedAt: entry.createdAt }, change);
  for (const cookie of readers) {
    const source = await call(t, 'GET', `/v2/notes/${original.id}/import`, { cookie });
    assert.equal(source.status, 200);
    assert.deepEqual(json(source)['links'], [{ id: merged.id, title: '合并结果' }]);
    assert.deepEqual((json(source)['variants'] as { markdown: string }[]).map((row) => row.markdown),
      ['导入原文', '校对原文']);
    const merge = await call(t, 'GET', `/v2/notes/${merged.id}/import`, { cookie });
    assert.equal(merge.status, 200);
    assert.deepEqual(json(merge)['links'], [{ id: original.id, title: '导入原版' }]);
    const read = await call(t, 'GET', `/v2/notes/${original.id}`, { cookie });
    assert.equal(read.status, 200);
    assert.equal(json(read)['readOnly'], true);
    for (const path of [`/v2/memory/entries/${entry.id}`, `/v2/agreements/${agreement.id}`]) {
      const response = await call(t, 'GET', path, { cookie });
      assert.equal(response.status, 200);
      const context = json(response)['sourceContext'] as { kind: string; ref: string; text: string };
      assert.equal(context?.kind, 'note');
      assert.equal(context.ref, original.id);
      assert.equal(context.text, '# 导入原版\n原文正文');
    }
    const rejected = await call(t, 'PUT', `/v2/notes/${original.id}`, { cookie,
      body: { requestId: `readonly-${cookie === user ? 'user' : 'system'}-note`, version: 1, markdown: '覆盖原文' } });
    assert.equal(rejected.status, 400);
  }
  assert.deepEqual(t.state.notes.require(original.id), original);
});

test('系统浏览器可读私密备份标题和预览，实际覆盖恢复仍只能由本人确认', async () => {
  const note = t.state.notes.create({ markdown: '# 阅读随记\n备份中的正文', folder: '笔记', author: 'user', private: true });
  const backup = t.state.backups.begin('private-backup-read', 'manual');
  t.state.backups.complete(backup.id);
  const current = t.state.notes.save(note.id, 1, { markdown: '# 阅读随记\n现在的正文' });
  for (const cookie of readers) {
    const detail = await call(t, 'GET', `/v2/backups/${backup.id}`, { cookie });
    assert.equal(detail.status, 200);
    const object = (json(detail)['objects'] as { id: string; label: string; private: boolean }[])
      .find((row) => row.id === note.id)!;
    assert.equal(object.label, '阅读随记');
    assert.equal(object.private, true);
    const preview = await call(t, 'POST', `/v2/backups/${backup.id}/restore-preview`, { cookie,
      body: { requestId: `private-preview-${cookie === user ? 'user' : 'system'}`, kind: 'note', objectId: note.id } });
    assert.equal(preview.status, 200);
    assert.equal(json(preview)['before'], '# 阅读随记\n现在的正文');
    assert.equal(json(preview)['after'], '# 阅读随记\n备份中的正文');
    const body = json(preview);
    const read = await call(t, 'GET', `/v2/restore-previews/${String(body['id'])}`, { cookie });
    assert.equal(read.status, 200);
    assert.equal(json(read)['after'], body['after']);
    const denied = await call(t, 'POST', `/v2/backups/${backup.id}/restore`, { cookie: readers[1]!, body: {
      requestId: `system-cannot-restore-${cookie === user ? 'user' : 'system'}`,
      previewId: body['id'], digest: body['digest'], backupName: body['backupName'], askVersion: body['askVersion'],
    } });
    assert.equal(denied.status, 403);
    assert.equal(json(denied)['code'], 'user_confirmation_required');
  }
  assert.deepEqual(t.state.notes.require(note.id), current);
  assert.equal(t.state.notes.versions(note.id).length, 2);
});

test('旧 unlock 仅兼容已可读状态，不登记解锁、确认或请求回执，系统会话也无需本人身份', async () => {
  const note = t.state.notes.create({ markdown: '# 旧客户端\n正文', folder: '笔记', author: 'user', private: true });
  for (const cookie of readers) {
    const body = { requestId: `legacy-unlock-${cookie === user ? 'user' : 'system'}` };
    for (let i = 0; i < 2; i += 1) {
      const response = await call(t, 'POST', `/v2/notes/${note.id}/unlock`, { cookie, body });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { unlocked: true });
      assert.equal(t.state.apiRequests.find(body.requestId), undefined);
    }
    assert.equal((await call(t, 'POST', '/v2/notes/missing/unlock', { cookie, body })).status, 404);
  }
  assert.deepEqual(t.state.notes.require(note.id), note);
  assert.equal(t.state.notes.versions(note.id).length, 1);
  assert.equal(t.state.deviceKeys.liveFor(system.device.id), undefined);
});

test('笔记直接读取仍要求有效会话，退出或撤销后不能读正文、图片、搜索或兼容 unlock', async () => {
  const asset = t.state.notes.writeAsset(Buffer.from('private image'), 'image/png');
  const note = t.state.notes.create({ markdown: '# 私密\n正文', folder: '笔记', author: 'user', private: true });
  assert.equal((await call(t, 'DELETE', '/v2/session', { cookie: user })).status, 200);
  t.state.devices.revoke(system.device.id, t.clock.now().toISOString());
  for (const cookie of [undefined, ...readers]) {
    const options = cookie === undefined ? {} : { cookie };
    for (const path of [`/v2/notes/${note.id}`, `/v2/notes/${note.id}/versions/1`,
      `/v2/notes/assets/${asset.name}`, '/v2/notes', '/v2/search?q=正文&type=notes']) {
      assert.equal((await call(t, 'GET', path, options)).status, 401, path);
    }
    assert.equal((await call(t, 'POST', `/v2/notes/${note.id}/unlock`, {
      ...options, body: { requestId: 'invalid-session-unlock' },
    })).status, 401);
  }
  assert.deepEqual(t.state.notes.require(note.id), note);
});

test('系统浏览器保存已读私密笔记仍按 AI 记录版本，不冒充本人', async () => {
  const note = t.state.notes.create({ markdown: '本人原文', folder: '笔记', author: 'user', private: true });
  const response = await call(t, 'PUT', `/v2/notes/${note.id}`, { cookie: readers[1]!,
    body: { requestId: 'system-private-note-save', version: 1, markdown: '内部浏览器改稿' } });
  assert.equal(response.status, 200);
  assert.equal(json(response)['author'], 'ai');
  assert.equal(t.state.notes.versions(note.id)[0]?.author, 'ai');
  assert.equal(t.state.notes.readVersion(note.id, 1)?.version.author, 'user');
});
