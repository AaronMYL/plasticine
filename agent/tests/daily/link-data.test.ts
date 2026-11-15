import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLinkData, checkLinkText, cleanSite } from '../../src/daily/index.ts';
import { ARTICLE_URLS, unsafeUrl } from '../url-fixtures.ts';

test('旧来源和站点的协议相对地址也只留主机，普通文章文字参数不变', () => {
  const raw = unsafeUrl().replace('https:', '');
  const data = { source: raw, site: raw, blockedSites: [raw], title: `文章 ${ARTICLE_URLS[0]}` };
  assert.equal(cleanSite(raw), 'example.com');
  assert.deepEqual(checkLinkData(data), {
    source: 'example.com', site: 'example.com', blockedSites: ['example.com'], title: data.title,
  });
  // 11-14 起自己用不清洗：文字里认得出的链接照原写法留着。
  assert.equal(checkLinkText(`原文 ${raw}`), `原文 ${raw}`);
  assert.equal(checkLinkText('坏的 https://[私事 后面'), '坏的  后面');
  assert.equal(data.source, raw, '不改写传入的旧记录');
});

test('Markdown 链接照原写法留着（11-14 起自己用不清洗）：闭合括号、嵌套路径括号、片段和后面的中文标点都不动', () => {
  for (const raw of [
    '[文档](https://e.test/#章节)',
    '[文档](https://e.test/a_(b(c))#章节)。下一句',
    '（[文档](https://e.test/a_(b)?token=abc#章节)），继续；结束。',
    '[文档](//e.test/a_(b)#章节)，继续',
  ]) {
    assert.equal(checkLinkText(raw), raw);
    assert.deepEqual(checkLinkData({ summary: raw }), { summary: raw });
  }
});
