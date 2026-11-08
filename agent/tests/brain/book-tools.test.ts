import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createBookTools } from '../../src/brain/index.ts';
import { anchorQuote } from '../../src/brain/index.ts';
import type { Tool } from '../../src/brain/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function addBook(): string {
  const id = 'book-1';
  const long = '长'.repeat(30_000);
  t.state.bookFiles.write(id, {
    source: Buffer.from('x'),
    format: 'txt',
    chapters: [
      { title: '卷一', html: '<h2>卷一</h2><p>余生乾隆癸未冬。</p><p>事如春梦了无痕。</p>', text: '卷一余生乾隆癸未冬。事如春梦了无痕。' },
      { title: '卷二', html: `<p>${long}</p>`, text: long },
    ],
    images: [],
  });
  t.state.books.create({
    title: '浮生六记', author: '沈复', language: 'zh', format: 'txt', fileName: '浮生六记.txt', sourceBytes: 1,
    sourceSha256: 'a'.repeat(64), coverAsset: null,
    toc: [{ title: '卷一', chars: 18 }, { title: '卷二', chars: long.length }], charCount: 18 + long.length,
  }, id);
  return id;
}

function tool(name: string): Tool {
  const found = createBookTools(t.state).find((entry) => entry.name === name);
  assert.ok(found, `应有工具 ${name}`);
  return found;
}

async function run(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const signal = new AbortController().signal;
  const result = await tool(name).execute(args as never, { signal } as never);
  return JSON.parse(String(result)) as Record<string, unknown>;
}

test('读书工具列出图书馆、在书里找、按块分行读一章，长章分段读', async () => {
  const id = addBook();
  const list = JSON.parse(String(await tool('book_list').execute({} as never,
    { signal: new AbortController().signal } as never))) as Record<string, unknown>[];
  assert.equal(list[0]?.['title'], '浮生六记');
  const found = await run('book_search', { bookId: id, q: '春梦' });
  assert.equal((found['hits'] as unknown[]).length, 1);
  assert.equal(found['untrustedMaterial'], true);
  const first = await run('book_read', { bookId: id, chapter: 0 });
  assert.equal(first['text'], '卷一\n余生乾隆癸未冬。\n事如春梦了无痕。');
  const part = await run('book_read', { bookId: id, chapter: 1 });
  assert.equal(part['next'], 24_000);
  const rest = await run('book_read', { bookId: id, chapter: 1, from: 24_000 });
  assert.equal(rest['next'], null);
});

test('删掉的书读不到', async () => {
  const id = addBook();
  const book = t.state.books.require(id);
  t.state.books.update(id, book.version, { deletedAt: '2026-11-01T00:00:00.000Z' });
  await assert.rejects(run('book_read', { bookId: id, chapter: 0 }), /删掉/);
});

test('重点的原句在章里找到才有位置，找不到就返回空', () => {
  assert.deepEqual(anchorQuote('东坡云：事如春梦了无痕。', 2, '事如春梦了无痕'),
    { chapter: 2, start: 4, end: 11, quote: '事如春梦了无痕' });
  assert.equal(anchorQuote('东坡云', 0, '不在书里'), null);
});
