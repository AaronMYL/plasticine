import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { SearchResponseSchema } from '../../shared/api/index.ts';
import { Value } from 'typebox/value';
import { brainChange, openTestState, userChange, userSource, type TestState } from './helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

/** 主线里说一句（2026-11-05 起对话只在主线），返回它的引用。 */
function say(role: 'user' | 'assistant', text: string, lineId = t.state.lines.main().id): string {
  const message = role === 'user'
    ? { role, content: text, timestamp: 0 }
    : { role, content: [{ type: 'text', text }], timestamp: 0 };
  return `line:${lineId}:${t.state.lineMessages.append(lineId, role, message).seq}`;
}

test('界面统一查找覆盖私密笔记全文、所有线上的对话、记忆和信息流，排除已删除内容', () => {
  const note = t.state.notes.create({ markdown: '# 一篇笔记\n' + '前文'.repeat(300) + '冰川计划细节',
    folder: '笔记', author: 'user' });
  const privateNote = t.state.notes.create({ markdown: '# 冰川私密', private: true, folder: '笔记', author: 'user' });
  const removed = t.state.notes.create({ markdown: '# 冰川已删除', folder: '笔记', author: 'user' });
  t.state.notes.markDeleted(removed.id);
  const message = say('user', '冰川对话');
  const background = t.state.lines.create({ kind: 'background', parentLineId: null, projectId: null, title: '后台' });
  const backgroundSaid = say('user', '冰川后台', background.id);
  const sourceId = userSource(t.state);
  // 旧的 memory_entries 不再参与查找（2026-11-03）：记忆查的是主题文档，一份文档一条结果。
  t.state.memory.create({ text: '冰川旧条目', kind: 'quote', basis: 'self_reported',
    sourceId, provenance: '对话' }, brainChange());
  const memory = t.state.memoryDocs.docs.create({ kind: 'topic', title: '远行', summary: '出门的打算',
    createdBy: 'brain' });
  t.state.memoryDocs.lines.add({ docId: memory.id, section: 'note', text: '冰川记忆', basis: 'stated',
    anchors: [{ kind: 'message', ref: message }], inferenceId: null, writtenBy: 'brain', writtenRef: null });
  const archived = t.state.memory.create({ text: '冰川归档', kind: 'interpretation', basis: 'inferred',
    sourceId, provenance: '对话' }, brainChange());
  t.state.memory.update(archived.id, archived.version, { deletedAt: '2026-10-27T08:00:00.000Z' }, userChange());
  const source = t.state.feedSources.create({ kind: 'interest', label: '自然' });
  const feed = t.state.feedItems.add({ sourceId: source.id, title: '冰川信息', origin: 'feed',
    day: '2026-10-27', arrivedAt: '2026-10-27T08:00:00.000Z', dedupeKey: 'search-feed' }).item;
  const response = t.state.search.query({ q: '冰川' });
  assert.equal(Value.Check(SearchResponseSchema, response), true);
  assert.deepEqual(new Set(response.results.map((row) => row.id)),
    new Set([note.id, privateNote.id, message, backgroundSaid, memory.id, feed.id]));
  assert.match(response.results.find((row) => row.id === note.id)!.excerpt, /冰川计划细节/);
  assert.equal(response.total, 6);
  assert.deepEqual(new Set(t.state.search.query({ q: '冰川', type: 'conversation' }).results.map((row) => row.id)),
    new Set([message, backgroundSaid]));
});

test('同秒的笔记以种类和编号稳定翻页，SQL通配符按普通文字处理', () => {
  const at = '2026-10-27T08:00:00.000Z';
  const ids = [];
  for (let i = 0; i < 22; i += 1) {
    ids.push(t.state.notes.create({ markdown: `同秒%_笔记${i}`, author: 'user', folder: '笔记' },
      { createdAt: at, updatedAt: at }).id);
  }
  let page = t.state.search.query({ q: '%_', limit: 3 });
  const found = page.results.map((row) => row.id);
  while (page.nextCursor !== null) {
    page = t.state.search.query({ q: '%_', cursor: page.nextCursor, limit: 3 });
    found.push(...page.results.map((row) => row.id));
  }
  assert.equal(found.length, 22);
  assert.deepEqual(new Set(found), new Set(ids));
  assert.equal(t.state.search.query({ q: "%' OR 1=1--" }).total, 0);
});

test('Plasticine 在主线里说的话按原文查得到，标题是第一行，来路写 Plasticine', () => {
  const ref = say('assistant', '先核对路线\n\n' + '前文'.repeat(300) + '海拔较高，需要调整行程');
  const found = t.state.search.query({ q: '海拔', type: 'conversation' }).results[0]!;
  assert.equal(found.id, ref);
  assert.equal(found.title, '先核对路线');
  assert.equal(found.detail, 'Plasticine');
  assert.match(found.excerpt, /海拔较高/);
});

test('游标翻完全部命中且没有重复，后新增记录等待刷新，游标不能换关键词套用', () => {
  for (let i = 0; i < 126; i += 1) {
    t.state.notes.create({ markdown: `分页检验 ${i}`, author: 'user', folder: '笔记' });
  }
  let page = t.state.search.query({ q: '分页', limit: 17 });
  assert.equal(page.total, 126);
  const firstCursor = page.nextCursor!;
  const ids = page.results.map((row) => row.id);
  const added = t.state.notes.create({ markdown: '分页新记录', author: 'user', folder: '笔记' });
  while (page.nextCursor !== null) {
    page = t.state.search.query({ q: '分页', limit: 17, cursor: page.nextCursor });
    ids.push(...page.results.map((row) => row.id));
  }
  assert.equal(ids.length, 126);
  assert.equal(new Set(ids).size, 126);
  assert.equal(ids.includes(added.id), false);
  assert.equal(t.state.search.query({ q: '分页' }).total, 127);
  assert.throws(() => t.state.search.query({ q: '别的', cursor: firstCursor }), /翻页/);
});

test('回填时读不出一篇笔记就明确失败，不把部分结果或零条冒充完整查找；补回来重建后照常', () => {
  const note = t.state.notes.create({ markdown: '重要正文', folder: '笔记', author: 'user' });
  const file = join(dirname(t.path), 'notes', note.bodyFile);
  const body = readFileSync(file);
  rmSync(file);
  t.state.search.rebuild(['note']);
  assert.throws(() => t.state.search.query({ q: '重要' }), /笔记.*读取/);
  assert.equal(t.state.search.query({ q: '重要', type: 'conversation' }).total, 0);
  writeFileSync(file, body);
  t.state.search.rebuild(['note']);
  assert.deepEqual(t.state.search.query({ q: '重要' }).results.map((row) => row.id), [note.id]);
});

test('记忆中的约定和术语可查找', () => {
  const agreement = t.state.agreements.create({ kind: 'collaboration', text: '远足约定', scope: '周末' }, brainChange());
  const term = t.state.agreements.create({ kind: 'term', title: '远足', text: '步行探索', scope: '通用',
    termTier: 'exact' }, brainChange());
  const found = t.state.search.query({ q: '远足', type: 'memory' }).results;
  assert.deepEqual(new Set(found.map((row) => row.kind)), new Set(['agreement', 'term']));
  assert.deepEqual(new Set(found.map((row) => row.id)), new Set([agreement.id, term.id]));
});

test('⌘K 能搜到图书（书名、作者），结果的种类是 book、类型是 books', () => {
  const book = t.state.books.create({ title: '冰川与人', author: '沈复', language: 'zh', format: 'epub',
    fileName: '冰川与人.epub', sourceBytes: 1024, sourceSha256: 'd'.repeat(64), coverAsset: null,
    toc: [{ title: '卷一', chars: 100 }], charCount: 100 });
  const all = t.state.search.query({ q: '冰川' });
  assert.equal(Value.Check(SearchResponseSchema, all), true);
  assert.deepEqual(all.results.map((row) => [row.kind, row.id]), [['book', book.id]]);
  assert.deepEqual(t.state.search.query({ q: '沈复', type: 'books' }).results.map((row) => row.id), [book.id]);
});

test('对话的结果带上线的种类：主线、旁聊、后台线分得开，点开能跳到那条线', () => {
  const main = say('user', '雪山主线');
  const side = t.state.lines.create({ kind: 'side', parentLineId: null, projectId: null, title: '旁聊' });
  const sideSaid = say('user', '雪山旁聊', side.id);
  const background = t.state.lines.create({ kind: 'background', parentLineId: null, projectId: null, title: '后台' });
  const backgroundSaid = say('user', '雪山后台', background.id);
  const kinds = new Map(t.state.search.query({ q: '雪山', type: 'conversation' }).results
    .map((row) => [row.id, row.lineKind]));
  assert.deepEqual(kinds, new Map([[main, 'main'], [sideSaid, 'side'], [backgroundSaid, 'background']]));
});
