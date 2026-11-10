import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { publishBookSpace, backfillBookSpaces } from '../../src/brain/book-spaces.ts';
import { writeSpace } from '../../src/subs/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });
function book() {
  return t.state.books.create({ title: '小团队示例', author: '示例作者', language: 'zh', format: 'txt',
    fileName: 'sample.txt', sourceBytes: 20, sourceSha256: 'a'.repeat(64), coverAsset: null,
    toc: [{ title: '理解团队', chars: 100 }, { title: '责任清楚', chars: 200 }], charCount: 300 });
}

test('旧图书大纲重建一次，保留关联，章节比例来自字数，回原文保留位置', () => {
  const b = book();
  const row = t.state.bookInsights.create({ bookId: b.id, kind: 'outline', status: 'ready',
    sourceSha256: b.sourceSha256 });
  const insight = t.state.bookInsights.update(row.id, row.version, { content: { note: '旧的归纳说明',
    parts: [{ chapter: 0, title: '理解团队', summary: '把职责说清楚。', points: [] },
      { chapter: 1, offset: 7, title: '责任清楚', summary: '保留判断的理由。', points: [] }] } });
  t.state.bookProgress.save({ bookId: b.id, chapter: 1, offset: 7, percent: 0.36, deviceLabel: '测试机' }, null);
  assert.equal(backfillBookSpaces(t.state), 1);
  const page = t.state.spaces.forBook(b.id)[0]!;
  assert.equal(page.category, 'booknote');
  assert.equal(page.sourceUrl, `book:${b.id}:outline`);
  assert.match(page.html!, /data-link="book:[^\"]+:1:7"/);
  assert.match(page.html!, /data-book-chapter="1"/);
  assert.match(page.html!, /33\.33/);
  assert.doesNotMatch(page.html!, /旧的归纳说明/);
  assert.equal(backfillBookSpaces(t.state), 0);
  const next = publishBookSpace(t.state, b, insight, true)!;
  assert.equal(next.id, page.id);
  const edited = writeSpace(t.state, { id: next.id, version: next.version, title: next.title,
    html: '<h1>这份图书大纲已经由用户重新整理过了。</h1>' }, 'user').space;
  assert.equal(publishBookSpace(t.state, b, insight)?.html, edited.html);
});

test('大纲和重点分别关联空间，重点类别和真实引文位置保留，去掉的重点不再显示', () => {
  const b = book();
  const row = t.state.bookInsights.create({ bookId: b.id, kind: 'key_points', status: 'ready',
    sourceSha256: b.sourceSha256 });
  const insight = t.state.bookInsights.update(row.id, row.version, { dismissedPointIds: ['p2'], content: { points: [
    { id: 'p1', text: '交接时留下判断理由。', category: '方法', basis: 'quoted',
      anchors: [{ chapter: 1, start: 12, end: 18, quote: '判断的理由' }] },
    { id: 'p2', text: '已经不要的重点。', basis: 'inferred', anchors: [] },
  ] } });
  const page = publishBookSpace(t.state, b, insight)!;
  assert.equal(page.sourceUrl, `book:${b.id}:key_points`);
  assert.match(page.html!, /方法/);
  assert.match(page.html!, /data-link="book:[^\"]+:1:12"/);
  assert.doesNotMatch(page.html!, /已经不要的重点/);
});

test('移到最近删除的图书笔记不会被旧内容转换重新创建', () => {
  const b = book();
  const row = t.state.bookInsights.create({ bookId: b.id, kind: 'outline', status: 'ready',
    sourceSha256: b.sourceSha256 });
  const ready = t.state.bookInsights.update(row.id, row.version, { content: { note: '',
    parts: [{ chapter: 0, title: '理解团队', summary: '把每个人的职责说清楚。', points: [] }] } });
  const page = publishBookSpace(t.state, b, ready)!;
  t.state.spaces.markDeleted(page.id, page.version);
  assert.equal(backfillBookSpaces(t.state), 0);
  assert.deepEqual(t.state.spaces.forBook(b.id), []);
});
