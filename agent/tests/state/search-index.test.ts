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

test('Chinese trigram FTS indexes 3+ chars and falls back to LIKE for 1-2 chars', () => {
  const note = t.state.notes.create({ markdown: '# 周末\n打算去杭州看大熊猫基地', folder: '笔记', author: 'user' });
  assert.deepEqual(ids('大熊猫'), [note.id]);
  assert.deepEqual(ids('熊猫基地'), [note.id]);
  assert.deepEqual(ids('杭州'), [note.id]);
  assert.deepEqual(ids('猫'), [note.id]);
  assert.deepEqual(ids('熊猫馆'), []);
});

test('Indexes user/Plasticine turns across lines; skips tool outputs and delegations', () => {
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

test('Index rolls back with txn and tracks note edits, deletes, and restores', () => {
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

test('Max-tier filter honors confirmed tiers only; untagged/suggested count as private', () => {
  const open = t.state.notes.create({ markdown: '合作笔记 灯塔', folder: '笔记', author: 'user' });
  const proposed = t.state.notes.create({ markdown: '建议笔记 灯塔', folder: '笔记', author: 'user' });
  const plain = t.state.notes.create({ markdown: '没标笔记 灯塔', folder: '笔记', author: 'user' });
  t.state.visibilityMarks.put('note', open.id, 0, { tier: 'partner', proposed: null, confirmed: true });
  t.state.visibilityMarks.put('note', proposed.id, 0, { proposed: 'public', confirmed: false });
  const { doc } = memoryDoc('爬山', '灯塔那条路好走');
  t.state.visibilityMarks.put('memory_topic', doc.id, 0, { tier: 'friend', proposed: null, confirmed: true });
  assert.deepEqual(ids('灯塔'), [open.id, proposed.id, plain.id, doc.id].sort());
  assert.deepEqual(ids('灯塔', { maxTier: 'public' }), []);
  assert.deepEqual(ids('灯塔', { maxTier: 'partner' }), [open.id]);
  assert.deepEqual(ids('灯塔', { maxTier: 'friend' }), [open.id, doc.id].sort());
  const mark = t.state.visibilityMarks.get('note', open.id)!;
  t.state.visibilityMarks.put('note', open.id, mark.version, { tier: 'private', proposed: null, confirmed: true });
  assert.deepEqual(ids('灯塔', { maxTier: 'friend' }), [doc.id]);
});

test('Memory index treats retired as archive, hides forgotten, follows doc renames', () => {
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

test('Book index covers title, author, notes linking to book; deletes hide all matches', () => {
  const book = t.state.books.create(bookInput());
  t.state.bookAnnotations.create({ bookId: book.id, chapter: 0, start: 1, end: 5, quote: '事如春梦了无痕',
    prefix: '', suffix: '', color: 'ochre', note: '想起外婆家的院子', origin: 'user', deviceLabel: null });
  for (const q of ['浮生六记', '沈复', '外婆家', '春梦了无痕']) {
    assert.deepEqual([...new Set(t.state.search.find({ q, kinds: ['book'] }).map((hit) => hit.objectId))],
      [book.id], q);
  }
  assert.deepEqual(ids('外婆家'), [book.id]);
  t.state.books.update(book.id, book.version, { deletedAt: '2026-10-27T09:00:00.000Z' });
  assert.deepEqual(t.state.search.find({ q: '外婆家', kinds: ['book'] }), []);
});

test('Bookmarks and feed index including URLs while excluding dismissed feed items', () => {
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

test('Search ranks by bm25 with title hits first and newer items breaking ties', () => {
  const body = t.state.notes.create({ markdown: '# 杂记\n顺便提到一次雪山徒步', folder: '笔记', author: 'user' });
  const titled = t.state.notes.create({ markdown: '# 雪山徒步\n装备清单', folder: '笔记', author: 'user' });
  assert.deepEqual(t.state.search.query({ q: '雪山徒步' }).results.map((row) => row.id), [titled.id, body.id]);
  const older = t.state.notes.create({ markdown: '# 记录\n冰岛环岛', folder: '笔记', author: 'user' });
  const newer = t.state.notes.create({ markdown: '# 记录\n冰岛环岛', folder: '笔记', author: 'user' });
  assert.deepEqual(t.state.search.query({ q: '冰岛环岛' }).results.map((row) => row.id), [newer.id, older.id]);
});

test('Pagination cursor must match current request\'s tier and archive filters', () => {
  for (let i = 0; i < 3; i += 1) t.state.notes.create({ markdown: `分档 ${i}`, folder: '笔记', author: 'user' });
  const page = t.state.search.query({ q: '分档', limit: 1 });
  assert.throws(() => t.state.search.query({ q: '分档', limit: 1, maxTier: 'public', cursor: page.nextCursor! }),
    /翻页/);
  assert.equal(t.state.search.query({ q: '分档', limit: 1, cursor: page.nextCursor! }).results.length, 1);
});

test('Legacy DB upgrade backfills chats, memory, agreements in batches once', async () => {
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
