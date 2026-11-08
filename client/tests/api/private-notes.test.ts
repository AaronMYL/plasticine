import { expect, it } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { NOW, seedNote } from '../helpers.tsx';

function setup(actor: 'user' | 'system' = 'user') {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
  fake.control.session.signInForDevelopment('已配对浏览器', actor);
  fake.control.session.backdate(11 * 60 * 1000);
  seedNote(fake, 'private', '# 我的备忘\n\n第一版内容', { private: true });
  fake.control.notes.externalEdit('private', '# 我的备忘\n\n更新后的内容');
  return fake;
}

it.each(['user', 'system'] as const)('%s 的有效配对会话可直接读私密正文、列表、搜索及历史', async (actor) => {
  const fake = setup(actor);
  const before = fake.control.notes.backupSnapshots();
  expect(await fake.api.notes.get('private')).toMatchObject({ private: true, readOnly: false,
    markdown: '# 我的备忘\n\n更新后的内容' });
  expect(await fake.api.notes.list({})).toEqual([expect.objectContaining({ title: '我的备忘',
    preview: expect.stringContaining('更新后的内容'), private: true })]);
  expect(await fake.api.notes.list({ q: '更新后的内容' })).toHaveLength(1);
  expect((await fake.api.search.query({ q: '更新后的内容', type: 'notes' })).results)
    .toEqual([expect.objectContaining({ kind: 'note', id: 'private', title: '我的备忘',
      excerpt: expect.stringContaining('更新后的内容') })]);
  expect((await fake.api.noteVersions.versions('private')).versions.map((version) => version.version)).toEqual([2, 1]);
  expect(await fake.api.noteVersions.version('private', 1)).toMatchObject({ markdown: '# 我的备忘\n\n第一版内容' });
  expect(fake.control.notes.backupSnapshots()).toEqual(before);
});

it.each(['user', 'system'] as const)('%s 可直接读私密备份预览，分类和真正恢复前的预览状态保留', async (actor) => {
  const fake = setup(actor);
  const backup = await fake.api.backups.create({ requestId: 'req_private_backup' });
  fake.control.notes.externalEdit('private', '# 我的备忘\n\n当前内容');
  const detail = await fake.api.backups.get(backup.id);
  expect(detail.objects).toEqual([expect.objectContaining({ id: 'private', label: '我的备忘', private: true })]);
  const preview = await fake.api.backups.preview(backup.id,
    { requestId: 'req_private_preview', kind: 'note', objectId: 'private' });
  expect(preview).toMatchObject({ private: true, status: 'pending',
    before: '# 我的备忘\n\n当前内容', after: '# 我的备忘\n\n更新后的内容' });
  expect(await fake.api.backups.getPreview(preview.id)).toEqual(preview);
  expect((await fake.api.notes.get('private')).markdown).toContain('当前内容');
});

it('会话失效后仍不能读取自己的普通或私密笔记', async () => {
  const fake = setup();
  seedNote(fake, 'ordinary', '普通内容');
  fake.control.session.expire();
  for (const id of ['private', 'ordinary']) {
    await expect(fake.api.notes.get(id)).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    await expect(fake.api.noteVersions.versions(id)).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  }
  await expect(fake.api.notes.list({})).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  await expect(fake.api.search.query({ q: '内容' })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
});

it.each(['user', 'system'] as const)('旧解锁接口对 %s 只作无副作用兼容，不再改变读取状态', async (actor) => {
  const fake = setup(actor);
  const before = fake.control.notes.backupSnapshots();
  const request = { target: { kind: 'note_unlock', noteId: 'private' } as const,
    bodyText: JSON.stringify({ requestId: 'req_legacy_unlock' }) };
  expect(await fake.api.notes.get('private')).toEqual(before[0]);
  expect(await fake.api.signed.send(request)).toEqual({ kind: 'note_unlocked' });
  expect(await fake.api.signed.send(request)).toEqual({ kind: 'note_unlocked' });
  expect(await fake.api.signed.lookup('req_legacy_unlock', request.target)).toBeNull();
  expect(fake.control.notes.backupSnapshots()).toEqual(before);
});
