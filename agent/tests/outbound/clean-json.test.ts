import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanOutboundJson, cleanOutboundText } from '../../src/outbound/clean-json.ts';
import { CLEAN_LINK_TEXT, CREDENTIAL_LINK_TEXT, TEXT_ARTICLE_URLS, UNSAFE_QUERY_VALUES } from '../url-fixtures.ts';

test('Outbound JSON deeply scrubs strings in objects/arrays without mutating input', () => {
  const raw = {
    title: CREDENTIAL_LINK_TEXT,
    nested: [null, false, 7, { text: CREDENTIAL_LINK_TEXT, more: [CREDENTIAL_LINK_TEXT] }],
    url: '/?ask=123', site: '普通标签',
  };
  const before = structuredClone(raw);
  assert.deepEqual(cleanOutboundJson(raw), {
    title: CLEAN_LINK_TEXT,
    nested: [null, false, 7, { text: CLEAN_LINK_TEXT, more: [CLEAN_LINK_TEXT] }],
    url: '/?ask=123', site: '普通标签',
  });
  assert.deepEqual(raw, before);
  assert.equal(cleanOutboundJson(CREDENTIAL_LINK_TEXT), CLEAN_LINK_TEXT);
});

test('Preserves quotes, parens, JSON wrapper, and benign article params across URLs', () => {
  for (const link of TEXT_ARTICLE_URLS) {
    const wrapped = `文章 (${link}) [${link}] {"url":"${link}"}；${CREDENTIAL_LINK_TEXT}`;
    const expected = `文章 (${link}) [${link}] {"url":"${link}"}；${CLEAN_LINK_TEXT}`;
    assert.equal(cleanOutboundText(wrapped), expected);
    assert.equal(cleanOutboundText(expected), expected);
  }
});

test('Ignores non-URL colons and @ text; leaves benign //todo verbatim', () => {
  for (const plain of [
    '10:30@会议室', 'a:b@c', 'u:p@x.example/a', 'user:pass@localhost:8080/a',
    '//todo', '没有网址', 'user@example.com', '/v2/concerns', '12:30', '',
  ]) {
    assert.equal(cleanOutboundText(plain), plain);
  }
});

test('Preserves emails and tags next to long text; scrubs only userinfo inside URLs', () => {
  const prefix = `${'a'.repeat(100_000)} user@example.com label: plain `;
  assert.equal(cleanOutboundText(`${prefix}${CREDENTIAL_LINK_TEXT} u:p@x.example`),
    `${prefix}${CLEAN_LINK_TEXT} u:p@x.example`);
  assert.equal(cleanOutboundText('prefix//u:p@x.example'), 'prefix//x.example');
});

test('Scrubs URLs with inner parens, IPv6 hosts, and nested URL query params', () => {
  assert.equal(cleanOutboundText('(https://u:p@x.example/a(b)?token=abc)'), '(https://x.example/a(b))');
  assert.equal(cleanOutboundText('[https://u:p@[::1]/?token=abc]'), '[https://[::1]/]');
  assert.equal(cleanOutboundText('链接 https://x.example/a?next=prefix%20%2F%2Fu%3Ap%40x.example&page=2'),
    '链接 https://x.example/a?page=2');
});

test('Strips only suspicious URL parts, keeping case, port, encoding, protocol-relative', () => {
  const tail = '/文%2f章/../页?ID=7&tag=%e4%b8%ad&tag=two+words';
  for (const head of ['HTTPS://', '//', 'ftp://']) {
    assert.equal(cleanOutboundText(`${head}u:p@News.Example:443${tail}&token=abc#fragment`),
      `${head}News.Example:443${tail}#fragment`);
    assert.equal(cleanOutboundText(`${head}News.Example:443#fragment`), `${head}News.Example:443#fragment`);
  }
  for (const value of UNSAFE_QUERY_VALUES) {
    const raw = `//News.Example/a?ID=7&next=${encodeURIComponent(value)}&tag=%e4%b8%ad`;
    assert.equal(cleanOutboundText(raw), '//News.Example/a?ID=7&tag=%e4%b8%ad');
  }
});

test('Parse failure still keeps user text/hash while stripping userinfo and bad params', () => {
  for (const host of ['[invalid', 'x.example:bad', '%invalid']) {
    const safe = `https://${host}/文章?ID=7&tag=%e4%b8%ad`;
    assert.equal(cleanOutboundText(`链接 "${safe}"`), `链接 "${safe}"`);
    const raw = `https://u:p@${host}/文章?ID=7&token=abc&tag=%e4%b8%ad#fragment`;
    assert.equal(cleanOutboundText(`链接 "${raw}"`), `链接 "${safe}#fragment"`);
  }
});

test('Outbound URL keeps in-app hash routes, normal anchors, and safe fragment params', () => {
  for (const fragment of ['#/books/space/space-1', '#section', '#page=2&view=wide', '#keyword=paper']) {
    const url = `https://example.com/${fragment}`;
    assert.equal(cleanOutboundText(`[打开](${url})`), `[打开](${url})`);
  }
});

test('Sensitive key in fragment params clears fragment; query scrub keeps safe route', () => {
  for (const key of ['access_token', 'id_token', 'token', 'code', 'state', 'key', 'secret', 'password',
    'SESSION_ID', 'access%5Ftoken']) {
    assert.equal(cleanOutboundText(`https://example.com/#page=2&${key}=synthetic`), 'https://example.com/');
  }
  assert.equal(cleanOutboundText('https://user:pass@example.com/?page=2&token=synthetic#/books/space/space-1'),
    'https://example.com/?page=2#/books/space/space-1');
});
