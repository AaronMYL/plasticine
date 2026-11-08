import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanOutboundJson, cleanOutboundText } from '../src/outbound.ts';
import { CLEAN_LINK_TEXT, CREDENTIAL_LINK_TEXT, TEXT_ARTICLE_URLS, UNSAFE_QUERY_VALUES } from './url-fixtures.ts';

test('出站 JSON 深入对象和数组清洗每个字符串，保留结构且不改传入的旧数据', () => {
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

test('文本里多条链接的引号、括号和 JSON 外壳保留，普通文章参数逐字不变', () => {
  for (const link of TEXT_ARTICLE_URLS) {
    const wrapped = `文章 (${link}) [${link}] {"url":"${link}"}；${CREDENTIAL_LINK_TEXT}`;
    const expected = `文章 (${link}) [${link}] {"url":"${link}"}；${CLEAN_LINK_TEXT}`;
    assert.equal(cleanOutboundText(wrapped), expected);
    assert.equal(cleanOutboundText(expected), expected);
  }
});

test('非链接的冒号和 @ 文字不碰，没有东西可清洗的 //todo 逐字保留', () => {
  for (const plain of [
    '10:30@会议室', 'a:b@c', 'u:p@x.example/a', 'user:pass@localhost:8080/a',
    '//todo', '没有网址', 'user@example.com', '/v2/concerns', '12:30', '',
  ]) {
    assert.equal(cleanOutboundText(plain), plain);
  }
});

test('长连续正文旁的邮箱和标签不误删，只清洗链接中的 userinfo', () => {
  const prefix = `${'a'.repeat(100_000)} user@example.com label: plain `;
  assert.equal(cleanOutboundText(`${prefix}${CREDENTIAL_LINK_TEXT} u:p@x.example`),
    `${prefix}${CLEAN_LINK_TEXT} u:p@x.example`);
  assert.equal(cleanOutboundText('prefix//u:p@x.example'), 'prefix//x.example');
});

test('括号在 URL 内、IPv6 主机和嵌套 URL 参数都清洗', () => {
  assert.equal(cleanOutboundText('(https://u:p@x.example/a(b)?token=abc)'), '(https://x.example/a(b))');
  assert.equal(cleanOutboundText('[https://u:p@[::1]/?token=abc]'), '[https://[::1]/]');
  assert.equal(cleanOutboundText('链接 https://x.example/a?next=prefix%20%2F%2Fu%3Ap%40x.example&page=2'),
    '链接 https://x.example/a?page=2');
});

test('只裁掉链接里的可疑部分，大小写、端口、路径编码和协议相对写法保持原样', () => {
  const tail = '/文%2f章/../页?ID=7&tag=%e4%b8%ad&tag=two+words';
  for (const head of ['HTTPS://', '//', 'ftp://']) {
    assert.equal(cleanOutboundText(`${head}u:p@News.Example:443${tail}&token=abc#fragment`),
      `${head}News.Example:443${tail}`);
    assert.equal(cleanOutboundText(`${head}News.Example:443#fragment`), `${head}News.Example:443`);
  }
  for (const value of UNSAFE_QUERY_VALUES) {
    const raw = `//News.Example/a?ID=7&next=${encodeURIComponent(value)}&tag=%e4%b8%ad`;
    assert.equal(cleanOutboundText(raw), '//News.Example/a?ID=7&tag=%e4%b8%ad');
  }
});

test('解析失败也保留用户文字，只去掉 userinfo、可疑查询参数和片段', () => {
  for (const host of ['[invalid', 'x.example:bad', '%invalid']) {
    const safe = `https://${host}/文章?ID=7&tag=%e4%b8%ad`;
    assert.equal(cleanOutboundText(`链接 "${safe}"`), `链接 "${safe}"`);
    const raw = `https://u:p@${host}/文章?ID=7&token=abc&tag=%e4%b8%ad#fragment`;
    assert.equal(cleanOutboundText(`链接 "${raw}"`), `链接 "${safe}"`);
  }
});
