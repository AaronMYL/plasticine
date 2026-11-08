import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanLinkData, cleanLinkText, cleanSite } from '../../src/daily/index.ts';
import { ARTICLE_URLS, SAFE_URL, unsafeUrl } from '../url-fixtures.ts';

test('旧来源和站点的协议相对地址也只留主机，普通文章文字参数不变', () => {
  const raw = unsafeUrl().replace('https:', '');
  const data = { source: raw, site: raw, blockedSites: [raw], title: `文章 ${ARTICLE_URLS[0]}` };
  assert.equal(cleanSite(raw), 'example.com');
  assert.deepEqual(cleanLinkData(data), {
    source: 'example.com', site: 'example.com', blockedSites: ['example.com'], title: data.title,
  });
  assert.equal(cleanLinkText(`原文 ${raw}`), `原文 ${SAFE_URL}`);
  assert.equal(data.source, raw, '不改写传入的旧记录');
});

test('清洗 Markdown 链接保留闭合括号、嵌套路径括号和后面的中文标点', () => {
  for (const [raw, expected] of [
    ['[文档](https://e.test/#章节)', '[文档](https://e.test/)'],
    ['[文档](https://e.test/a_(b(c))#章节)。下一句', '[文档](https://e.test/a_(b(c)))。下一句'],
    ['（[文档](https://e.test/a_(b)?token=abc#章节)），继续；结束。',
      '（[文档](https://e.test/a_(b))），继续；结束。'],
    ['[文档](//e.test/a_(b)#章节)，继续', '[文档](https://e.test/a_(b))，继续'],
  ]) {
    assert.ok(raw !== undefined && expected !== undefined);
    assert.equal(cleanLinkText(raw), expected);
    assert.deepEqual(cleanLinkData({ summary: raw }), { summary: expected });
  }
});
