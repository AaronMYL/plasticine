import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { writeSpace } from '../../src/subs/index.ts';
import { openTestState, type TestState } from './helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

test('空间写入和改版保留分类、来源、图书和文件夹，来源查询忽略已删除空间', () => {
  const first = writeSpace(t.state, { title: '示例网页归档', genre: 'report', html: '<h1>这是一篇示例网页的清楚结论标题</h1>',
    category: 'webarchive', sourceUrl: 'https://example.com/article#section', bookId: null, folder: '研究' }, 'ai').space;
  assert.equal(first.category, 'webarchive');
  assert.equal(t.state.spaces.findBySourceUrl(first.sourceUrl!)?.id, first.id);
  const next = writeSpace(t.state,
    { id: first.id, version: first.version, title: first.title, folder: '阅读' }, 'user').space;
  assert.equal(next.folder, '阅读');
  assert.equal(next.sourceUrl, first.sourceUrl);
  assert.equal(next.html, first.html);
  t.state.spaces.markDeleted(next.id, next.version);
  assert.equal(t.state.spaces.findBySourceUrl(first.sourceUrl!), undefined);
});
