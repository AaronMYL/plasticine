import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { renderBookPage } from '../../shared/book-space-page.ts';
import type { BookOutline } from '../../shared/state.ts';
import { BookInsightService } from '../../src/brain/book-insights.ts';
import { publishBookSpace, upgradeBookOutlineLayouts } from '../../src/brain/book-spaces.ts';
import type { TextModels } from '../../src/kernel/index.ts';
import { writeSpace } from '../../src/subs/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });
const SUMMARY = '本书从理解分工到记录判断，说明小团队如何通过清晰职责与持续复盘协作。';
const OUTLINE: BookOutline = { note: '按现有章节归纳，仅表示整理方法。', parts: [
  { chapter: 0, offset: 7, title: '分工', summary: '理解分工，先看各自承担什么职责。', points: ['职责'] },
  { chapter: 1, offset: 19, title: '复盘', summary: '记录判断的理由，并在协作后复盘。', points: ['判断理由'] },
], chapters: [
  { chapter: 0, offset: 11, title: '第一章', summary: '说明每个人的职责。', points: ['职责'] },
  { chapter: 1, offset: 23, title: '第二章', summary: '保留判断并复盘。', points: ['复盘'] },
] };

function fixture(summary?: string) {
  const book = t.state.books.create({ title: '协作示例', author: '示例作者', language: 'zh', format: 'txt',
    fileName: 'sample.txt', sourceBytes: 20, sourceSha256: 'a'.repeat(64), coverAsset: null,
    toc: [{ title: '第一章', chars: 100 }, { title: '第二章', chars: 200 }], charCount: 300 });
  const content = { ...OUTLINE, ...(summary === undefined ? {} : { summary }) };
  const created = t.state.bookInsights.create({ bookId: book.id, kind: 'outline', status: 'ready',
    sourceSha256: book.sourceSha256 });
  const insight = t.state.bookInsights.update(created.id, created.version, { content });
  const legacySummary = content.summary ?? content.parts.map((part) => part.summary).join(' ').slice(0, 400);
  const page = writeSpace(t.state, { title: `${book.title} · 大纲`, genre: 'report', category: 'booknote',
    sourceUrl: `book:${book.id}:outline`, bookId: book.id,
    html: renderBookPage({ bookId: book.id, toc: book.toc, currentChapter: 0,
      outline: { ...content, summary: legacySummary } }) }, 'ai').space;
  return { book, insight, page, content };
}

function service(answer: (request: Parameters<TextModels['ask']>[0]) => Promise<string>) {
  const calls: Parameters<TextModels['ask']>[0][] = [];
  let changed = 0;
  const instance = new BookInsightService({ state: t.state, now: () => new Date('2026-10-28T00:00:00Z'),
    changed: () => { changed++; }, model: { models: { ask: async (request) => {
      calls.push(request);
      return { text: await answer(request), complete: true };
    } } } });
  return { instance, calls, finished: async () => {
    const limit = Date.now() + 3000;
    while (changed === 0 && Date.now() < limit) await sleep(5);
    assert.ok(changed > 0, '补总述应完成并发出变更通知');
  } };
}

test('旧大纲只补一次全书短总述，保留章节位置和原空间，并留存原版 HTML', async () => {
  const { book, insight, page, content } = fixture();
  t.state.bookProgress.save({ bookId: book.id, chapter: 1, offset: 23, percent: 0.8, deviceLabel: '测试机' }, null);
  const runner = service(async () => JSON.stringify({ summary: SUMMARY }));
  runner.instance.start(book, 'outline', false);
  runner.instance.start(book, 'outline', false);
  await runner.finished();
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]!.purpose, 'book_outline');
  const material = String(runner.calls[0]!.messages[0]!.content);
  assert.match(material, /分工/);
  assert.match(material, /复盘/);
  assert.doesNotMatch(material, /按现有章节归纳/);
  const saved = t.state.bookInsights.get(insight.id)!;
  assert.deepEqual(saved.content, { ...content, summary: SUMMARY });
  const updated = t.state.spaces.require(page.id);
  assert.equal(updated.version, page.version + 1);
  assert.match(updated.html!, new RegExp(SUMMARY));
  assert.match(updated.html!, /:1:23/);
  assert.equal(t.state.spaces.revision(page.id, page.version)!.html, page.html);
  runner.instance.start(book, 'outline', false);
  await sleep(20);
  assert.equal(runner.calls.length, 1);
  assert.equal(t.state.spaces.forBook(book.id).length, 1);
});

test('已有完整短总述直接复用，服务启动不调用模型', async () => {
  const { book, insight, page } = fixture(SUMMARY);
  const runner = service(async () => { throw new Error('不应调用'); });
  runner.instance.recoverInterrupted();
  runner.instance.start(book, 'outline', false);
  await sleep(20);
  assert.equal(runner.calls.length, 0);
  assert.equal(t.state.bookInsights.get(insight.id)!.version, insight.version);
  assert.equal(t.state.spaces.require(page.id).html, page.html);
});

for (const summary of ['长'.repeat(70), '协作与判断']) {
  test(`非空旧总述保留原样，不按新生成标准重写：${summary.length}字`, async () => {
    const { book, insight, page } = fixture(summary);
    const runner = service(async () => JSON.stringify({ summary: SUMMARY }));
    runner.instance.start(book, 'outline', false);
    await sleep(20);
    assert.equal(runner.calls.length, 0);
    assert.deepEqual(t.state.bookInsights.get(insight.id), insight);
    assert.deepEqual(t.state.spaces.require(page.id), page);
  });
}

test('模型失败保留可读的旧内容和页面，下一次明确请求可以重试', async () => {
  const { book, insight, page, content } = fixture();
  const runner = service(async () => { throw new Error('暂时未取得结果'); });
  runner.instance.start(book, 'outline', false);
  await runner.finished();
  const failed = t.state.bookInsights.get(insight.id)!;
  assert.equal(failed.status, 'ready');
  assert.deepEqual(failed.content, content);
  assert.match(failed.error!, /总述/);
  assert.equal(t.state.spaces.require(page.id).html, page.html);
  const retry = service(async () => JSON.stringify({ summary: SUMMARY }));
  retry.instance.start(book, 'outline', false);
  await retry.finished();
  assert.equal((t.state.bookInsights.get(insight.id)!.content as BookOutline).summary, SUMMARY);
});

for (const answer of ['只有第一章。', '本书讨论分工、判断和协作'.repeat(8) + '。',
  '本书从理解分工到记录判断说明小团队如何通过清晰职责与持续复盘协作']) {
  test(`不把过短、过长或截断的模型结果写成全书总述：${answer.length}`, async () => {
    const { book, insight, page, content } = fixture();
    const runner = service(async () => JSON.stringify({ summary: answer }));
    runner.instance.start(book, 'outline', false);
    await runner.finished();
    assert.deepEqual(t.state.bookInsights.get(insight.id)!.content, content);
    assert.equal(t.state.spaces.require(page.id).html, page.html);
    assert.ok(t.state.bookInsights.get(insight.id)!.error);
  });
}

test('生成期间大纲被改动，不能覆盖新版本，也不能覆盖原空间', async () => {
  const { book, insight, page } = fixture();
  let resolve!: (text: string) => void;
  const runner = service(() => new Promise<string>((done) => { resolve = done; }));
  runner.instance.start(book, 'outline', false);
  const concurrent = t.state.bookInsights.update(insight.id, insight.version,
    { content: { ...OUTLINE, note: '另一轮已更新。' } });
  resolve(JSON.stringify({ summary: SUMMARY }));
  await runner.finished();
  assert.deepEqual(t.state.bookInsights.get(insight.id)!, concurrent);
  assert.equal(t.state.spaces.require(page.id).html, page.html);
});

for (const during of [false, true]) {
  test(`保护${during ? '生成期间' : '此前'}用户编辑的空间，源大纲仍可补总述`, async () => {
    const { book, insight, page } = fixture();
    const edit = () => writeSpace(t.state, { id: page.id, version: page.version, title: page.title,
      html: '<h1>用户重新整理的图书笔记。</h1>' }, 'user').space;
    const edited = during ? null : edit();
    let resolve!: (text: string) => void;
    const runner = service(() => new Promise<string>((done) => { resolve = done; }));
    runner.instance.start(book, 'outline', false);
    const keep = edited ?? edit();
    resolve(JSON.stringify({ summary: SUMMARY }));
    await runner.finished();
    assert.deepEqual(t.state.spaces.require(page.id), keep);
    assert.equal((t.state.bookInsights.get(insight.id)!.content as BookOutline).summary, SUMMARY);
  });
}

for (const purge of [false, true]) {
  test(`已${purge ? '永久' : '软'}删除的空间不调用模型，也不复活`, async () => {
    const { book, insight, page } = fixture();
    t.state.spaces.markDeleted(page.id, page.version);
    if (purge) t.state.libraryPurge.space(page.id);
    const runner = service(async () => JSON.stringify({ summary: SUMMARY }));
    runner.instance.start(book, 'outline', false);
    await sleep(20);
    assert.equal(runner.calls.length, 0);
    assert.equal(t.state.bookInsights.get(insight.id)!.version, insight.version);
    assert.equal(publishBookSpace(t.state, book, insight), null);
    assert.equal(t.state.spaces.forBook(book.id).length, 0);
  });
}

test('缺少总述时不把逐章摘要拼成假的一句话，章节和回原文入口仍可读', () => {
  const { book } = fixture();
  const html = renderBookPage({ bookId: book.id, toc: book.toc, currentChapter: null, outline: OUTLINE });
  assert.doesNotMatch(html, /<h1>一句话：/);
  assert.match(html, /data-book-chapter="1"/);
  assert.match(html, /:1:23/);
});

test('其他模型改写过的空间即使作者仍是 AI，也不按旧模板覆盖', async () => {
  const { book, page } = fixture();
  const edited = writeSpace(t.state, { id: page.id, version: page.version, title: page.title,
    html: page.html!.replace('<ol class="bn-list">', '<p>重新整理的章节</p><ol class="bn-list">') }, 'ai').space;
  const runner = service(async () => JSON.stringify({ summary: SUMMARY }));
  runner.instance.start(book, 'outline', false);
  await runner.finished();
  assert.deepEqual(t.state.spaces.require(page.id), edited);
});

test('AI 只改过空间标题也保护整个页面，不能用默认标题覆盖', async () => {
  const { book, insight, page } = fixture();
  const edited = writeSpace(t.state, { id: page.id, version: page.version,
    title: '留给下一次协作的笔记', html: page.html! }, 'ai').space;
  assert.equal(edited.html, page.html);
  const runner = service(async () => JSON.stringify({ summary: SUMMARY }));
  runner.instance.start(book, 'outline', false);
  await runner.finished();
  assert.deepEqual(t.state.spaces.require(page.id), edited);
  assert.equal((t.state.bookInsights.get(insight.id)!.content as BookOutline).summary, SUMMARY);
});

for (const purge of [false, true]) {
  test(`补述期间空间被${purge ? '永久' : '软'}删除，不恢复或另建空间`, async () => {
    const { book, page } = fixture();
    let resolve!: (text: string) => void;
    const runner = service(() => new Promise<string>((done) => { resolve = done; }));
    runner.instance.start(book, 'outline', false);
    t.state.spaces.markDeleted(page.id, page.version);
    if (purge) t.state.libraryPurge.space(page.id);
    resolve(JSON.stringify({ summary: SUMMARY }));
    await runner.finished();
    assert.equal(t.state.spaces.forBook(book.id).length, 0);
    const tombstone = t.state.spaces.findBySourceUrl(`book:${book.id}:outline`, 'booknote', true)!;
    assert.equal(tombstone.id, page.id);
    assert.notEqual(tombstone.deletedAt, null);
    if (purge) assert.equal(tombstone.html, null);
  });
}

test('11-11 版式升级：自动生成的旧大纲页（带色条）换成新版式，改过的旧页不动', () => {
  const { book, content } = fixture(SUMMARY);
  const old = t.state.spaces.findBySourceUrl(`book:${book.id}:outline`, 'booknote', true)!;
  const legacy = writeSpace(t.state, { id: old.id, version: old.version, title: old.title,
    html: renderBookPage({ bookId: book.id, toc: book.toc, currentChapter: null, outline: content },
      { legacy: true }) }, 'ai').space;
  assert.match(legacy.html!, /各部分字数比例/);
  assert.equal(upgradeBookOutlineLayouts(t.state), 1);
  const upgraded = t.state.spaces.require(old.id);
  assert.doesNotMatch(upgraded.html!, /bn-bar/);
  assert.match(upgraded.html!, /data-book-chapter="1"/);
  assert.equal(upgradeBookOutlineLayouts(t.state), 0);

  const other = fixture(SUMMARY);
  const page = t.state.spaces.findBySourceUrl(`book:${other.book.id}:outline`, 'booknote', true)!;
  const edited = writeSpace(t.state, { id: page.id, version: page.version, title: page.title,
    html: renderBookPage({ bookId: other.book.id, toc: other.book.toc, currentChapter: null,
      outline: other.content }, { legacy: true }).replace('<ol class="bn-list">', '<p>我补的</p><ol class="bn-list">') },
    'user').space;
  assert.equal(upgradeBookOutlineLayouts(t.state), 0);
  assert.equal(t.state.spaces.require(page.id).html, edited.html);
});
