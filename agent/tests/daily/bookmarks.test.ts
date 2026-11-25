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
import { checkBookmarkUrl, DailyError } from '../../src/daily/index.ts';

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

test('imports Chrome/Safari bookmark HTML: http(s) only, folder paths, unescaped, URL fallback title', () => {
  assert.deepEqual(parseBookmarkHtml(CHROME_EXPORT), [
    { title: 'Show HN & 规则', url: 'https://news.ycombinator.com/showhn.html', folders: ['书签栏'] },
    { title: '上架清单', url: 'https://www.producthunt.com/', folders: ['书签栏', 'Cyber Hunter'] },
    { title: 'https://weather.com.cn/', url: 'https://weather.com.cn/', folders: ['书签栏'] },
    { title: 'WKWebView · 注入', url: 'https://developer.apple.com/documentation/webkit/wkwebview',
      folders: ['plasticine'] },
  ]);
  assert.deepEqual(parseBookmarkHtml('<html><body>不是书签文件</body></html>'), []);
});

test('maps bookmark folder to project from innermost outward case-insensitively, or null', () => {
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

test('suggests project by domain majority (no ties), else unique mention in title/body, skips short', () => {
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

test('dedupes URLs case-insensitively on host ignoring empty #; pages exact; groups not deduped', () => {
  assert.equal(bookmarkKey('web', 'https://Example.com/a#'), bookmarkKey('web', 'https://example.com/a'));
  assert.notEqual(bookmarkKey('web', 'https://example.com/a#x'), bookmarkKey('web', 'https://example.com/a'));
  assert.equal(bookmarkKey('page', '#/notes/n1'), 'page:#/notes/n1');
  assert.equal(bookmarkKey('group', null), null);
  assert.equal(bookmarkHost('https://www.github.com/x'), 'github.com');
  assert.equal(bookmarkHost('#/notes/n1'), null);
});

test('stores web bookmark URL verbatim with #; rejects non-http(s) without echoing raw input', () => {
  assert.equal(checkBookmarkUrl('https://u:p@example.com/a?access_token=1&q=2#top'),
    'https://u:p@example.com/a?access_token=1&q=2#top');
  assert.throws(() => checkBookmarkUrl('ftp://example.com/'), DailyError);
  assert.throws(() => checkBookmarkUrl('https://[secret-token'), (error: unknown) =>
    error instanceof DailyError && !error.message.includes('secret'));
});
