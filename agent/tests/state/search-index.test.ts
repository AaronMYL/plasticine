// 统一全文索引（《优化清单》第 20 条）：中文分词、所有线的对话、档位过滤、记忆归档、写路径同事务、回填、图书。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { BookInput } from '../../shared/state.ts';
import { openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import { openState } from '../../src/state/index.ts';
import { openTestState, steppingClock, type TestState } from './helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

function say(lineId: string, role: 'user' | 'assistant' | 'toolResult', text: string,
  origin?: { kind: 'user' | 'delegation'; userText?: string }): string {
  const message = role === 'user' ? { role, content: text, timestamp: 0 }
    : { role, content: [{ type: 'text', text }], timestamp: 0 };
  const seq = t.state.lineMessages.append(lineId, role, message, origin === undefined ? null : { origin }).seq;
  return `line:${lineId}:${seq}`;
}

function ids(q: string, extra: Record<string, unknown> = {}): string[] {
  return t.state.search.query({ q, ...extra }).results.map((row) => row.id).sort();
}

function bookInput(overrides: Partial<BookInput> = {}): BookInput {
  return { title: '浮生六记', author: '沈复', language: 'zh', format: 'epub', fileName: '浮生六记.epub',
    sourceBytes: 1024, sourceSha256: 'a'.repeat(64), coverAsset: null, toc: [{ title: '卷一', chars: 10 }],
    charCount: 10, ...overrides };
}

function memoryDoc(title: string, line: string) {
  const doc = t.state.memoryDocs.docs.create({ kind: 'topic', title, summary: '', createdBy: 'brain' });
  const row = t.state.memoryDocs.lines.add({ docId: doc.id, section: 'note', text: line, basis: 'stated',
    anchors: [{ kind: 'message', ref: 'line:line-main:1' }], inferenceId: null, writtenBy: 'brain',
    writtenRef: null });
  return { doc, line: row };
}

test('中文按 trigram 分词：三个字以上走索引，一两个字退到 LIKE，都能命中', () => {
  const note = t.state.notes.create({ markdown: '# 周末\n打算去杭州看大熊猫基地', folder: '笔记', author: 'user' });
  assert.deepEqual(ids('大熊猫'), [note.id]);
  assert.deepEqual(ids('熊猫基地'), [note.id]);
  assert.deepEqual(ids('杭州'), [note.id]);
  assert.deepEqual(ids('猫'), [note.id]);
  assert.deepEqual(ids('熊猫馆'), []);
});

test('所有线上他和 Plasticine 说的话都进索引；工具结果和委派原文不进，他的话用他自己打的字', () => {
  const main = t.state.lines.main().id;
  const work = t.state.lines.create({ kind: 'background', parentLineId: main, projectId: null, title: '查资料' }).id;
  const mine = say(main, 'user', '帮我查海拔数据［笔记正文：拼进去的材料］', { kind: 'user', userText: '帮我查海拔数据' });
  const answer = say(work, 'assistant', '海拔数据整理好了');
  say(work, 'user', '委派：去查海拔数据', { kind: 'delegation' });
  say(work, 'toolResult', '海拔数据原始输出');
  assert.deepEqual(ids('海拔数据', { type: 'conversation' }), [mine, answer].sort());
  assert.deepEqual(ids('拼进去的材料'), []);
  const hits = t.state.search.find({ q: '海拔数据', kinds: ['message'], lineKinds: ['background'] });
  assert.deepEqual(hits.map((hit) => [hit.ref, hit.lineId, hit.lineKind]), [[answer, work, 'background']]);
});

test('事务回滚时索引跟着回滚；改了、删了、恢复的笔记索引都跟上', () => {
  assert.throws(() => t.state.transaction(() => {
    t.state.notes.create({ markdown: '回滚的笔记内容', folder: '笔记', author: 'user' });
    throw new Error('中途失败');
  }), /中途失败/);
  assert.deepEqual(ids('回滚的笔记'), []);
  const note = t.state.notes.create({ markdown: '原来的说法', folder: '笔记', author: 'user' });
  const saved = t.state.notes.save(note.id, note.version, { markdown: '后来的说法' });
  assert.deepEqual(ids('原来的说法'), []);
  assert.deepEqual(ids('后来的说法'), [note.id]);
  t.state.notes.markDeleted(note.id);
  assert.deepEqual(ids('后来的说法'), []);
  t.state.notes.restore(saved.id);
  assert.deepEqual(ids('后来的说法'), [note.id]);
});

test('按最高档位过滤：只有用户确认过的档位算数，没标的、只有建议的、上锁的笔记都是私密', () => {
  const open = t.state.notes.create({ markdown: '合作笔记 灯塔', folder: '笔记', author: 'user' });
  const proposed = t.state.notes.create({ markdown: '建议笔记 灯塔', folder: '笔记', author: 'user' });
  const locked = t.state.notes.create({ markdown: '上锁笔记 灯塔', private: true, folder: '笔记', author: 'user' });
  const plain = t.state.notes.create({ markdown: '没标笔记 灯塔', folder: '笔记', author: 'user' });
  t.state.visibilityMarks.put('note', open.id, 0, { tier: 'partner', proposed: null, confirmed: true });
  t.state.visibilityMarks.put('note', proposed.id, 0, { proposed: 'public', confirmed: false });
  t.state.visibilityMarks.put('note', locked.id, 0, { tier: 'public', proposed: null, confirmed: true });
  const { doc } = memoryDoc('爬山', '灯塔那条路好走');
  t.state.visibilityMarks.put('memory_topic', doc.id, 0, { tier: 'friend', proposed: null, confirmed: true });
  assert.deepEqual(ids('灯塔'), [open.id, proposed.id, locked.id, plain.id, doc.id].sort());
  assert.deepEqual(ids('灯塔', { maxTier: 'public' }), []);
  assert.deepEqual(ids('灯塔', { maxTier: 'partner' }), [open.id]);
  assert.deepEqual(ids('灯塔', { maxTier: 'friend' }), [open.id, doc.id].sort());
  const mark = t.state.visibilityMarks.get('note', open.id)!;
  t.state.visibilityMarks.put('note', open.id, mark.version, { tier: 'private', proposed: null, confirmed: true });
  assert.deepEqual(ids('灯塔', { maxTier: 'friend' }), [doc.id]);
});

test('记忆：退休的行和文档算归档，默认不查、含归档才查；「忘掉」的行哪里都查不到；文档改名跟着改', () => {
  const { doc, line } = memoryDoc('饮食', '不吃香菜');
  const forgotten = t.state.memoryDocs.lines.add({ docId: doc.id, section: 'note', text: '香菜过敏的说法',
    basis: 'stated', anchors: [{ kind: 'message', ref: 'line:line-main:1' }], inferenceId: null, writtenBy: 'brain',
    writtenRef: null });
  t.state.memoryDocs.lines.retire(line.id, line.version, 'no_longer_true');
  t.state.memoryDocs.lines.retire(forgotten.id, forgotten.version, 'forgotten');
  assert.deepEqual(ids('香菜'), []);
  assert.deepEqual(ids('香菜', { includeArchived: true }), [doc.id]);
  const archived = t.state.search.find({ q: '香菜', includeArchived: true });
  assert.deepEqual(archived.map((hit) => [hit.ref, hit.archived]), [[line.id, true]]);
  const live = memoryDoc('作息', '早睡早起');
  t.state.memoryDocs.docs.update(live.doc.id, live.doc.version, { title: '睡觉' });
  const hit = t.state.search.find({ q: '早睡早起' })[0]!;
  assert.equal(hit.title, '睡觉');
  assert.equal(hit.objectId, live.doc.id);
});

test('图书：书名、作者、批注都收进索引，点开是那本书；删书后都查不到', () => {
  const book = t.state.books.create(bookInput());
  t.state.bookAnnotations.create({ bookId: book.id, chapter: 0, start: 1, end: 5, quote: '事如春梦了无痕',
    prefix: '', suffix: '', color: 'ochre', note: '想起外婆家的院子', origin: 'user', deviceLabel: null });
  for (const q of ['浮生六记', '沈复', '外婆家', '春梦了无痕']) {
    assert.deepEqual([...new Set(t.state.search.find({ q, kinds: ['book'] }).map((hit) => hit.objectId))],
      [book.id], q);
  }
  // 11-07 ⌘K：界面接口也能搜到图书（批注命中的点开也是那本书）。
  assert.deepEqual(ids('外婆家'), [book.id]);
  t.state.books.update(book.id, book.version, { deletedAt: '2026-10-27T09:00:00.000Z' });
  assert.deepEqual(t.state.search.find({ q: '外婆家', kinds: ['book'] }), []);
});

test('书签和信息流进索引：网址也查得到，不感兴趣的信息流不查', () => {
  const mark = t.state.bookmarks.create({ kind: 'web', title: '路线攻略', target: 'https://trail.example.cn/a',
    snapshot: '沿着溪谷走', origin: 'manual', position: 0 });
  const source = t.state.feedSources.create({ kind: 'interest', label: '户外' });
  const kept = t.state.feedItems.add({ sourceId: source.id, title: '溪谷新开放', origin: 'feed', day: '2026-10-27',
    arrivedAt: '2026-10-27T08:00:00.000Z', dedupeKey: 'kept' }).item;
  const disliked = t.state.feedItems.add({ sourceId: source.id, title: '溪谷广告', origin: 'feed',
    day: '2026-10-27', arrivedAt: '2026-10-27T08:00:00.000Z', dedupeKey: 'disliked' }).item;
  t.state.feedItems.update(disliked.id, disliked.version, { reaction: 'dislike' });
  assert.deepEqual(ids('trail.example'), [mark.id]);
  assert.deepEqual(ids('溪谷'), [mark.id, kept.id].sort());
});

test('排序：bm25 相关度为主，标题命中的在前；相关度一样时新的在前', () => {
  const body = t.state.notes.create({ markdown: '# 杂记\n顺便提到一次雪山徒步', folder: '笔记', author: 'user' });
  const titled = t.state.notes.create({ markdown: '# 雪山徒步\n装备清单', folder: '笔记', author: 'user' });
  assert.deepEqual(t.state.search.query({ q: '雪山徒步' }).results.map((row) => row.id), [titled.id, body.id]);
  const older = t.state.notes.create({ markdown: '# 记录\n冰岛环岛', folder: '笔记', author: 'user' });
  const newer = t.state.notes.create({ markdown: '# 记录\n冰岛环岛', folder: '笔记', author: 'user' });
  assert.deepEqual(t.state.search.query({ q: '冰岛环岛' }).results.map((row) => row.id), [newer.id, older.id]);
});

test('翻页参数里的档位和归档要和这次查找一致', () => {
  for (let i = 0; i < 3; i += 1) t.state.notes.create({ markdown: `分档 ${i}`, folder: '笔记', author: 'user' });
  const page = t.state.search.query({ q: '分档', limit: 1 });
  assert.throws(() => t.state.search.query({ q: '分档', limit: 1, maxTier: 'public', cursor: page.nextCursor! }),
    /翻页/);
  assert.equal(t.state.search.query({ q: '分档', limit: 1, cursor: page.nextCursor! }).results.length, 1);
});

test('旧库升级：打开时把已有的对话、记忆、约定分批回填进索引，再打开不重复回填', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-index-'));
  const path = join(directory, 'plasticine.sqlite');
  try {
    const old = openDatabase(path);
    migrate(old, MIGRATIONS.filter((entry) => entry.id < '0067'), steppingClock());
    const at = '2026-10-20T08:00:00.000Z';
    old.run(`INSERT INTO lines (id, created_at, updated_at, kind, title, status)
      VALUES ('line-main', $at, $at, 'main', '主对话', 'idle')`, { at });
    for (let seq = 1; seq <= 450; seq += 1) {
      old.run(`INSERT INTO line_messages (line_id, seq, role, message, created_at)
        VALUES ('line-main', $seq, 'user', $message, $at)`,
      { seq, message: JSON.stringify({ role: 'user', content: `第${seq}句 旧对话回填`, timestamp: 0 }), at });
    }
    old.close();
    const state = openState({ path, now: steppingClock() });
    try {
      assert.ok(state.newlyApplied.includes('0067-search-index'));
      assert.equal(state.search.query({ q: '旧对话回填' }).total, 450);
      assert.deepEqual(state.search.query({ q: '第450句' }).results.map((row) => row.id), ['line:line-main:450']);
    } finally {
      state.close();
    }
    const again = openState({ path, now: steppingClock() });
    try {
      assert.deepEqual(again.newlyApplied, []);
      assert.equal(again.search.query({ q: '旧对话回填' }).total, 450);
    } finally {
      again.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
