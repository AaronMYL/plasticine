import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

const create = (folder: string, markdown = '标题\n正文') => {
  return t.state.notes.create({ markdown, folder, author: 'user' });
};

test('文件夹按已有笔记补齐，含空文件夹；重命名同时移动已删除笔记，恢复保留目的地', () => {
  const note = create('旅行');
  t.state.notes.folders.create('空文件夹');
  t.state.notes.markDeleted(note.id);
  t.state.notes.folders.rename('旅行', '出行');
  assert.equal(t.state.notes.require(note.id).folder, '出行');
  assert.equal(t.state.notes.restore(note.id).folder, '出行');
  assert.deepEqual(t.state.notes.folders.list().folders.map((folder) => folder.name), ['笔记', '出行', '空文件夹']);
  assert.equal(t.state.notes.folders.list().deletedCount, 0);
});

test('移除文件夹先确认去向，笔记和版本正文都保留；重排不会丢掉文件夹', () => {
  const note = create('旅行');
  t.state.notes.folders.create('工作');
  t.state.notes.folders.move('工作', -1);
  assert.deepEqual(t.state.notes.folders.list().folders.map((folder) => folder.name), ['笔记', '工作', '旅行']);
  t.state.notes.folders.remove('旅行', '工作');
  assert.equal(t.state.notes.require(note.id).folder, '工作');
  assert.equal(t.state.notes.readVersion(note.id, 1)?.markdown, '标题\n正文');
  throwsState(() => t.state.notes.folders.remove('工作', '工作'), 'invalid_input');
  throwsState(() => t.state.notes.folders.rename('笔记', '新名字'), 'invalid_input');
});

test('正文全文搜索在分页之前匹配，模型工具仍可独立排除私密笔记', () => {
  create('笔记', `普通标题\n${'别的内容'.repeat(80)}\n正文深处的关键词`);
  create('笔记', '普通标题\n没有匹配');
  const secret = t.state.notes.create({ markdown: '私密\n正文深处的关键词', folder: '笔记', author: 'user', private: true });
  const matches = t.state.notes.list({ q: '关键词', readable: (note) => !note.private }, { limit: 1 });
  assert.equal(matches.length, 1);
  assert.notEqual(matches[0]?.id, secret.id);
  assert.deepEqual(t.state.notes.list({ q: '关键词', readable: (note) => !note.private }, { limit: 1, offset: 1 }), []);
});

test('恢复是幂等的，AI 保存保留作者和原始版本，已完成写入不会重复', () => {
  const note = create('笔记');
  const saved = t.state.notes.saveAs(note.id, 1, { markdown: '标题\n正文\n补充' }, 'ai');
  assert.equal(saved.author, 'ai');
  assert.equal(t.state.notes.versions(note.id)[0]?.author, 'ai');
  const deleted = t.state.notes.markDeleted(note.id);
  const restored = t.state.notes.restore(deleted.id);
  assert.equal(restored.deletedAt, null);
  assert.equal(t.state.notes.restore(deleted.id).version, restored.version);
});

test('按旧版修订号读取原文校对润色，并以旧ID映射恢复合并双向关系，不改原始payload', () => {
  const target = create('笔记', '# 合并结果');
  const payload = { note: {
    versions: { import: 1, proofread: 3, polish: 5 },
    history: [{ revision: 1, markdown: '原文' }, { revision: 3, markdown: '校对' }, { revision: 5, markdown: '润色' }],
    mergedInto: { id: 'old-result', title: '合并结果' },
  } };
  const original = t.state.notes.create({ markdown: '润色', folder: '已合并（原版）', author: 'ai', readOnly: true },
    { legacyPayload: payload });
  t.state.legacyIds.record({ sourceDb: 'files/notes', sourceTable: 'note-json', legacyId: 'old-result',
    targetTable: 'notes', targetId: target.id });
  const details = t.state.notes.importDetails.get(original.id);
  assert.deepEqual(details.variants.map((variant) => variant.markdown), ['原文', '校对', '润色']);
  assert.equal(details.mergedInto, target.id);
  assert.deepEqual(t.state.notes.require(original.id).legacyPayload, payload);
  const merged = t.state.notes.create({ markdown: '# 合并', folder: '笔记', author: 'user' }, {
    legacyPayload: { note: { merges: [{ fromId: 'old-original' }, { fromId: 'split', splitAt: '2026-10-31' },
      { fromId: 'not-imported' }] } },
  });
  t.state.legacyIds.record({ sourceDb: 'files/notes', sourceTable: 'note-json', legacyId: 'old-original',
    targetTable: 'notes', targetId: original.id });
  assert.deepEqual(t.state.notes.importDetails.get(merged.id).originalIds, [original.id]);
  assert.deepEqual(t.state.notes.importDetails.get(merged.id).unresolvedIds, ['not-imported']);
});
