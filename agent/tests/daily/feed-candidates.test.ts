import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interleave, interestWeight, looksLikeArticle } from '../../src/daily/feed-candidates.ts';
import type { FeedCandidate } from '../../shared/feed-selection.ts';

function candidate(sourceId: string, index: number, weight = 2, via = '搜索'): FeedCandidate {
  return { id: `${sourceId}-${index}`, sourceId, sourceLabel: sourceId, title: `消息 ${sourceId} ${index}`,
    url: `https://example.test/articles/${sourceId}-${index}`, text: '材料', publishedAt: '2026-10-29T07:00:00Z',
    site: 'example.test', undated: false, via, weight };
}

test('interest weight adjusts +1 like, -2 dismiss within bounds and skips disabled interests', () => {
  assert.equal(interestWeight('more', 0), 3);
  assert.equal(interestWeight('normal', 3), 3);
  assert.equal(interestWeight('less', -2), 0.5);
  assert.equal(interestWeight('more', 99), 5);
  assert.equal(interestWeight('off', 99), 0);
});

test('rotates two candidate streams by interest, sorts by time within group, caps pool at 40', () => {
  const inputs = Array.from({ length: 30 }, (_, i) => candidate('a', i))
    .concat(Array.from({ length: 30 }, (_, i) => candidate('b', i, 2, '订阅：例子')));
  const pool = interleave(inputs);
  assert.equal(pool.length, 40);
  assert.deepEqual(pool.slice(0, 4).map((row) => row.id), ['a-0', 'b-0', 'a-1', 'b-1']);
  assert.equal(inputs.length, 60);
  assert.equal(pool[1]?.via, '订阅：例子');
});

test('filters homepages, wikis, and topic pages while keeping short paths and query-param articles', () => {
  for (const url of ['不是网址', 'https://example.test/',
    'https://en.wikipedia.org/wiki/Example', 'https://baike.baidu.com/item/example',
    'https://www.zhihu.com/topic/123456']) {
    assert.equal(looksLikeArticle(url), false, url);
  }
  for (const url of ['https://news.example.test/articles/123', 'https://example.com/?p=123',
    'https://example.com/a/1', 'https://example.com/a']) {
    assert.equal(looksLikeArticle(url), true, url);
  }
});
