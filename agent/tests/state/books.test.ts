import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { BookAnnotationInput, BookInput } from '../../shared/state.ts';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function bookInput(overrides: Partial<BookInput> = {}): BookInput {
  return {
    title: '浮生六记',
    author: '沈复',
    language: 'zh',
    format: 'epub',
    fileName: '浮生六记.epub',
    sourceBytes: 1024,
    sourceSha256: 'a'.repeat(64),
    coverAsset: null,
    toc: [{ title: '卷一 闺房记乐', chars: 9000 }, { title: '卷二 闲情记趣', chars: 7000 }],
    charCount: 16000,
    ...overrides,
  };
}

function annotation(bookId: string, overrides: Partial<BookAnnotationInput> = {}): BookAnnotationInput {
  return {
    bookId,
    chapter: 0,
    start: 10,
    end: 20,
    quote: '事如春梦了无痕',
    prefix: '东坡云：“',
    suffix: '”，苟不记之笔墨',
    color: 'ochre',
    note: null,
    origin: 'user',
    deviceLabel: 'iPhone',
    ...overrides,
  };
}

test('新书进图书馆；同一个文件按摘要找回原来那本，删了就找不回', () => {
  const book = t.state.books.create(bookInput());
  assert.equal(t.state.books.findBySource('a'.repeat(64))?.id, book.id);
  assert.deepEqual(t.state.books.live().map((entry) => entry.title), ['浮生六记']);
  t.state.books.update(book.id, book.version, { deletedAt: '2026-11-01T10:00:00.000Z' });
  assert.equal(t.state.books.findBySource('a'.repeat(64)), undefined);
  assert.deepEqual(t.state.books.live(), []);
  assert.equal(t.state.books.get(book.id)?.title, '浮生六记');
});

test('图书馆按最近打开排在前，没打开过的按加入时间', () => {
  const first = t.state.books.create(bookInput({ title: '人间词话', sourceSha256: 'b'.repeat(64) }));
  t.state.books.create(bookInput({ title: '陶庵梦忆', sourceSha256: 'c'.repeat(64) }));
  t.state.books.update(first.id, first.version, { lastOpenedAt: '2027-01-01T00:00:00.000Z' });
  assert.deepEqual(t.state.books.live().map((entry) => entry.title), ['人间词话', '陶庵梦忆']);
});

test('进度每本书一行：第一次新建，之后按版本改，旧版本改不动', () => {
  const book = t.state.books.create(bookInput());
  const input = { bookId: book.id, chapter: 0, offset: 120, percent: 0.05, deviceLabel: 'Mac' };
  const first = t.state.bookProgress.save(input, null);
  assert.equal(first.id, book.id);
  const second = t.state.bookProgress.save({ ...input, chapter: 1, percent: 0.6 }, first.version);
  assert.equal(second.chapter, 1);
  throwsState(() => t.state.bookProgress.save({ ...input, chapter: 0 }, first.version), 'version_conflict');
  assert.equal(t.state.bookProgress.get(book.id)?.percent, 0.6);
});

test('标注按章和位置排，删掉的只打时间不再列出', () => {
  const book = t.state.books.create(bookInput());
  const later = t.state.bookAnnotations.create(annotation(book.id, { chapter: 1, start: 5, end: 9 }));
  const earlier = t.state.bookAnnotations.create(annotation(book.id, { note: '写下来，才不辜负' }));
  assert.deepEqual(t.state.bookAnnotations.forBook(book.id).map((entry) => entry.id), [earlier.id, later.id]);
  t.state.bookAnnotations.update(later.id, later.version, { deletedAt: '2026-11-01T10:00:00.000Z' });
  assert.deepEqual(t.state.bookAnnotations.forBook(book.id).map((entry) => entry.id), [earlier.id]);
  assert.equal(t.state.bookAnnotations.get(later.id)?.quote, '事如春梦了无痕');
});

test('标注的结束位置不能在开始之前，颜色只能是四种之一', () => {
  const book = t.state.books.create(bookInput());
  throwsState(() => t.state.bookAnnotations.create(annotation(book.id, { start: 9, end: 9 })), 'invalid_input');
  const wrongColor = { ...annotation(book.id), color: 'yellow' } as unknown as BookAnnotationInput;
  throwsState(() => t.state.bookAnnotations.create(wrongColor), 'invalid_input');
});

test('大纲和重点每本书每种一行，「不要」的重点记在行里', () => {
  const book = t.state.books.create(bookInput());
  const row = t.state.bookInsights.create({ bookId: book.id, kind: 'key_points', status: 'generating',
    sourceSha256: book.sourceSha256 });
  assert.deepEqual(row.dismissedPointIds, []);
  const ready = t.state.bookInsights.update(row.id, row.version, { status: 'ready', content: { points: [] },
    dismissedPointIds: ['p1'] });
  assert.deepEqual(t.state.bookInsights.find(book.id, 'key_points')?.dismissedPointIds, ['p1']);
  assert.equal(t.state.bookInsights.find(book.id, 'outline'), undefined);
  assert.deepEqual(t.state.bookInsights.generating(), []);
  assert.equal(ready.status, 'ready');
});

test('书的文件整本写进 books/<id>/，读章节和插图；同一本不覆盖', () => {
  const files = t.state.bookFiles;
  files.write('book-1', {
    source: Buffer.from('原文件'),
    format: 'epub',
    chapters: [{ title: '卷一', html: '<p>余生乾隆癸未冬</p>', text: '余生乾隆癸未冬' }],
    images: [{ key: 'cover', mime: 'image/png', bytes: Buffer.from([1, 2, 3]) }],
  });
  const folder = join(dirname(t.path), 'books', 'book-1');
  assert.ok(existsSync(join(folder, 'source.epub')));
  assert.equal(files.chapter('book-1', 0).text, '余生乾隆癸未冬');
  assert.deepEqual([...files.asset('book-1', 'cover').data], [1, 2, 3]);
  assert.equal(files.source('book-1').toString(), '原文件');
  throwsState(() => files.chapter('book-1', 3), 'not_found');
  throwsState(() => files.asset('book-1', '../cover'), 'not_found');
  throwsState(() => files.write('book-1', { source: Buffer.from('x'), format: 'epub', chapters: [], images: [] }),
    'duplicate');
  assert.deepEqual(readdirSync(join(dirname(t.path), 'books')), ['book-1']);
});

test('书的编号带路径分隔符时拒绝当作目录名', () => {
  throwsState(() => t.state.bookFiles.folderFor('../escape'), 'invalid_input');
});
