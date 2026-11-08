// 书签两端共用的规则（shared/bookmarks.ts）和网页书签的网址清洗：浏览器导出的书签 HTML 怎么读、文件夹对到哪个项目、
// 没归项目的推哪个、同一个网址算不算同一条。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bookmarkHost,
  bookmarkKey,
  folderProject,
  parseBookmarkHtml,
  suggestProject,
  type SuggestionCandidate,
} from '../../shared/bookmarks.ts';
import { cleanBookmarkUrl, DailyError } from '../../src/daily/index.ts';

const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>
    <DL><p>
        <DT><A HREF="https://news.ycombinator.com/showhn.html" ADD_DATE="1700000001">Show HN &amp; 规则</A>
        <DT><H3>Cyber Hunter</H3>
        <DL><p>
            <DT><A HREF="https://www.producthunt.com/" ICON="data:image/png;base64,xx">上架清单</A>
            <DT><A HREF='javascript:void(0)'>小书签工具</A>
        </DL><p>
        <DT><A HREF="https://weather.com.cn/">  </A>
    </DL><p>
    <DT><H3>plasticine</H3>
    <DL><p>
        <DT><A HREF="https://developer.apple.com/documentation/webkit/wkwebview">WKWebView &#183; 注入</A>
    </DL><p>
</DL><p>`;

test('读 Chrome / Safari 导出的书签 HTML：只要 http(s)，带上从外到里的文件夹，解开转义，没名字的用网址', () => {
  assert.deepEqual(parseBookmarkHtml(CHROME_EXPORT), [
    { title: 'Show HN & 规则', url: 'https://news.ycombinator.com/showhn.html', folders: ['书签栏'] },
    { title: '上架清单', url: 'https://www.producthunt.com/', folders: ['书签栏', 'Cyber Hunter'] },
    { title: 'https://weather.com.cn/', url: 'https://weather.com.cn/', folders: ['书签栏'] },
    { title: 'WKWebView · 注入', url: 'https://developer.apple.com/documentation/webkit/wkwebview',
      folders: ['plasticine'] },
  ]);
  assert.deepEqual(parseBookmarkHtml('<html><body>不是书签文件</body></html>'), []);
});

test('文件夹对到项目：从最里面一层往外找，名字一样（不分大小写）就是；对不上是 null', () => {
  const projects = [{ id: 'p-hunter', name: 'Cyber Hunter' }, { id: 'p-plasticine', name: 'Plasticine' }];
  assert.equal(folderProject(['书签栏', 'Cyber Hunter'], projects), 'p-hunter');
  assert.equal(folderProject(['plasticine', '调研'], projects), 'p-plasticine');
  assert.equal(folderProject(['书签栏'], projects), null);
  assert.equal(folderProject([], projects), null);
});

function candidate(overrides: Partial<SuggestionCandidate>): SuggestionCandidate {
  return { id: 'x', kind: 'web', target: 'https://example.com/', title: '一页', projectId: null, snapshot: null,
    ...overrides };
}

test('推项目：同网站多半在哪就推哪（并列不推）；其次名字或正文开头只提到一个项目才推；短项目名不拿来找', () => {
  const projects = [{ id: 'p-hunter', name: 'Cyber Hunter' }, { id: 'p-plasticine', name: 'Plasticine' },
    { id: 'p-me', name: '个人' }];
  const filed = [candidate({ id: 'a', target: 'https://github.com/a', projectId: 'p-plasticine' }),
    candidate({ id: 'b', target: 'https://github.com/b', projectId: 'p-plasticine' }),
    candidate({ id: 'c', target: 'https://github.com/c', projectId: 'p-hunter' })];
  const loose = candidate({ id: 'd', target: 'https://github.com/d' });
  assert.equal(suggestProject(loose, [...filed, loose], projects), 'p-plasticine');
  const tie = [...filed, candidate({ id: 'e', target: 'https://github.com/e', projectId: 'p-hunter' })];
  assert.equal(suggestProject(loose, tie, projects), null);
  const named = candidate({ id: 'f', target: 'https://blog.example.com/', title: '给 cyber hunter 找冷启动渠道' });
  assert.equal(suggestProject(named, [named], projects), 'p-hunter');
  const both = candidate({ id: 'g', snapshot: 'Plasticine 和 Cyber Hunter 的关系' });
  assert.equal(suggestProject(both, [both], projects), null);
  const short = candidate({ id: 'h', title: '个人记账' });
  assert.equal(suggestProject(short, [short], projects), null);
  assert.equal(suggestProject(candidate({ projectId: 'p-me' }), [], projects), null);
});

test('同一个网址算同一条：主机名不分大小写、末尾空的 # 不算；页面按地址原样；分组不去重', () => {
  assert.equal(bookmarkKey('web', 'https://Example.com/a#'), bookmarkKey('web', 'https://example.com/a'));
  assert.notEqual(bookmarkKey('web', 'https://example.com/a#x'), bookmarkKey('web', 'https://example.com/a'));
  assert.equal(bookmarkKey('page', '#/notes/n1'), 'page:#/notes/n1');
  assert.equal(bookmarkKey('group', null), null);
  assert.equal(bookmarkHost('https://www.github.com/x'), 'github.com');
  assert.equal(bookmarkHost('#/notes/n1'), null);
});

test('网页书签的网址：去掉账号密码和像口令的参数，# 留着；不是 http(s) 不收，错误里不带原文', () => {
  assert.equal(cleanBookmarkUrl('https://u:p@example.com/a?access_token=1&q=2#top'), 'https://example.com/a?q=2#top');
  assert.throws(() => cleanBookmarkUrl('ftp://example.com/'), DailyError);
  assert.throws(() => cleanBookmarkUrl('https://[secret-token'), (error: unknown) =>
    error instanceof DailyError && !error.message.includes('secret'));
});
