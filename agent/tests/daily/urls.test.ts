import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanUrl, DailyError, siteOf } from '../../src/daily/index.ts';
import { ARTICLE_URLS, SAFE_URL, unsafeUrl, UNSAFE_QUERY_VALUES } from '../url-fixtures.ts';

test('外部链接保留普通参数和原始编码，去掉用户名密码与片段，清洗可重复执行', () => {
  const query = 'ID=7&Topic=AI%20news&tag=%e4%b8%ad&tag=two+words&next=article&keyword=ai';
  const raw = `https://user:pass@example.com/a?${query}&access_token=abc#fragment`;
  const expected = `https://example.com/a?${query}`;
  assert.equal(cleanUrl(raw), expected);
  assert.equal(cleanUrl(cleanUrl(raw)), expected);
  assert.equal(cleanUrl('http://example.com:8080/a?%70age=2&pageToken=abc'),
    'http://example.com:8080/a?%70age=2');
  assert.equal(siteOf(raw), 'example.com');
  for (const protocol of ['ftp', 'file', 'javascript', 'data']) {
    assert.throws(() => cleanUrl(`${protocol}://example.com/a`), DailyError);
  }
});

test('任意参数值里的嵌套网址、三层以内编码、长令牌、base64 和 JWT 全部丢弃', () => {
  for (const name of ['next', 'custom', 'id', 'v', '__biz', 'sn', 'keyword']) {
    for (const value of UNSAFE_QUERY_VALUES) {
      const query = new URLSearchParams({ [name]: value });
      assert.equal(cleanUrl(`https://example.com/a?${query}`), 'https://example.com/a');
    }
  }
  assert.equal(cleanUrl('https://example.com/a?next=https://x.example/?token=abc'), 'https://example.com/a');
  assert.equal(cleanUrl('https://example.com/a?id=https://x.example/?token=abc'), 'https://example.com/a');
  assert.equal(cleanUrl(unsafeUrl()), SAFE_URL);
  assert.equal(cleanUrl('https://example.com/a?id=good&id=https%3A%2F%2Fx.example%2F&page=2'),
    'https://example.com/a?id=good&page=2');
});

test('微信公众号、Hacker News、YouTube 和自定义文章参数清洗后原样保留', () => {
  for (const url of ARTICLE_URLS) {
    assert.equal(cleanUrl(url), url);
    assert.equal(cleanUrl(cleanUrl(url)), url);
  }
});

test('每层解码后检查整个参数值，前缀和 JSON 包裹的协议相对链接不能绕过', () => {
  for (const link of ['//user:pass@x.example/a', 'https://user:pass@x.example/a']) {
    for (const wrapped of [`prefix ${link}`, JSON.stringify({ link }), `(${link})`]) {
      let value = wrapped;
      for (let layer = 0; layer < 3; layer += 1) {
        const query = new URLSearchParams({ page: '2', next: value });
        assert.equal(cleanUrl(`https://example.com/a?${query}`), 'https://example.com/a?page=2');
        value = encodeURIComponent(value);
      }
    }
  }
});

test('长令牌从 32 位开始，但 40 位以内的纯十六进制摘要保留，普通分隔符不误删', () => {
  const values = ['g'.repeat(31), 'a'.repeat(32), 'ABCDEF0123'.repeat(4),
    'example.com', 'abc==', 'a&b', 'a?b', 'a/b', 'a:b'];
  for (const value of values) {
    const url = `https://example.com/a?custom=${encodeURIComponent(value)}`;
    assert.equal(cleanUrl(url), url);
  }
  for (const layers of [0, 1, 2, 3]) {
    let value = 'https://x.example/?token=abc';
    for (let layer = 0; layer < layers; layer += 1) {
      value = encodeURIComponent(value);
    }
    assert.equal(cleanUrl(`https://example.com/a?next=${value}&idx=1`), 'https://example.com/a?idx=1');
  }
});

test('深层或损坏的百分号编码不能绕过检查，普通百分号文本仍可保留', () => {
  let nested = 'https://x.example/?token=abc';
  for (let layer = 0; layer < 8; layer += 1) {
    nested = encodeURIComponent(nested);
  }
  assert.equal(cleanUrl(`https://example.com/a?next=${nested}&mid=2`), 'https://example.com/a?mid=2');
  assert.equal(cleanUrl('https://example.com/a?next=%253A%ZZ&mid=2'), 'https://example.com/a?mid=2');
  assert.equal(cleanUrl('https://example.com/a?discount=50%25'), 'https://example.com/a?discount=50%25');
});
