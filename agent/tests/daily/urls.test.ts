import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUrl, DailyError, linkKey, siteOf } from '../../src/daily/index.ts';
import { ARTICLE_URLS, SAFE_URL, unsafeUrl, UNSAFE_QUERY_VALUES } from '../url-fixtures.ts';

test('store/display keeps raw URLs checking scheme/length only, preserving params, fragment, auth', () => {
  const raw = 'https://user:pass@example.com/a?id=7&access_token=abc#fragment';
  assert.equal(checkUrl(raw), raw);
  assert.equal(checkUrl(` ${raw} `), raw);
  for (const protocol of ['ftp', 'file', 'javascript', 'data']) {
    assert.throws(() => checkUrl(`${protocol}://example.com/a`), DailyError);
  }
  assert.throws(() => checkUrl(`https://example.com/${'a'.repeat(5000)}`), DailyError);
});

test('linkKey keeps normal params and raw encoding, strips userinfo and fragment idempotently', () => {
  const query = 'ID=7&Topic=AI%20news&tag=%e4%b8%ad&tag=two+words&next=article&keyword=ai';
  const raw = `https://user:pass@example.com/a?${query}&access_token=abc#fragment`;
  const expected = `https://example.com/a?${query}`;
  assert.equal(linkKey(raw), expected);
  assert.equal(linkKey(linkKey(raw)), expected);
  assert.equal(linkKey('http://example.com:8080/a?%70age=2&pageToken=abc'),
    'http://example.com:8080/a?%70age=2');
  assert.equal(siteOf(raw), 'example.com');
  for (const protocol of ['ftp', 'file', 'javascript', 'data']) {
    assert.throws(() => linkKey(`${protocol}://example.com/a`), DailyError);
  }
});

test('strips nested URLs, up to 3x encoded, long tokens, base64, and JWTs from any query param', () => {
  for (const name of ['next', 'custom', 'id', 'v', '__biz', 'sn', 'keyword']) {
    for (const value of UNSAFE_QUERY_VALUES) {
      const query = new URLSearchParams({ [name]: value });
      assert.equal(linkKey(`https://example.com/a?${query}`), 'https://example.com/a');
    }
  }
  assert.equal(linkKey('https://example.com/a?next=https://x.example/?token=abc'), 'https://example.com/a');
  assert.equal(linkKey('https://example.com/a?id=https://x.example/?token=abc'), 'https://example.com/a');
  assert.equal(linkKey(unsafeUrl()), SAFE_URL);
  assert.equal(linkKey('https://example.com/a?id=good&id=https%3A%2F%2Fx.example%2F&page=2'),
    'https://example.com/a?id=good&page=2');
});

test('preserves WeChat, Hacker News, YouTube, and custom article params verbatim after sanitizing', () => {
  for (const url of ARTICLE_URLS) {
    assert.equal(linkKey(url), url);
    assert.equal(linkKey(linkKey(url)), url);
  }
});

test('checks full param value at each decode layer blocking prefixed and JSON-wrapped scheme-less URL', () => {
  for (const link of ['//user:pass@x.example/a', 'https://user:pass@x.example/a']) {
    for (const wrapped of [`prefix ${link}`, JSON.stringify({ link }), `(${link})`]) {
      let value = wrapped;
      for (let layer = 0; layer < 3; layer += 1) {
        const query = new URLSearchParams({ page: '2', next: value });
        assert.equal(linkKey(`https://example.com/a?${query}`), 'https://example.com/a?page=2');
        value = encodeURIComponent(value);
      }
    }
  }
});

test('flags long tokens from 32 chars while keeping <=40-char hex digests and normal delimiters', () => {
  const values = ['g'.repeat(31), 'a'.repeat(32), 'ABCDEF0123'.repeat(4),
    'example.com', 'abc==', 'a&b', 'a?b', 'a/b', 'a:b'];
  for (const value of values) {
    const url = `https://example.com/a?custom=${encodeURIComponent(value)}`;
    assert.equal(linkKey(url), url);
  }
  for (const layers of [0, 1, 2, 3]) {
    let value = 'https://x.example/?token=abc';
    for (let layer = 0; layer < layers; layer += 1) {
      value = encodeURIComponent(value);
    }
    assert.equal(linkKey(`https://example.com/a?next=${value}&idx=1`), 'https://example.com/a?idx=1');
  }
});

test('deeply or malformed percent-encoding cannot bypass check while normal percent text stays', () => {
  let nested = 'https://x.example/?token=abc';
  for (let layer = 0; layer < 8; layer += 1) {
    nested = encodeURIComponent(nested);
  }
  assert.equal(linkKey(`https://example.com/a?next=${nested}&mid=2`), 'https://example.com/a?mid=2');
  assert.equal(linkKey('https://example.com/a?next=%253A%ZZ&mid=2'), 'https://example.com/a?mid=2');
  assert.equal(linkKey('https://example.com/a?discount=50%25'), 'https://example.com/a?discount=50%25');
});
