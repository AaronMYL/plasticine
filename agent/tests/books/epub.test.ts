import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookParseError, parseBook } from '../../src/books/index.ts';
import { assertWellFormed, fakeJpeg, fakePng, makeEpub, makeZip, xhtml } from './fixtures.ts';

function code(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof BookParseError, String(error));
    return error.code;
  }
  return 'none';
}

const EPUB3_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:1</dc:identifier>
    <dc:title>三体</dc:title>
    <dc:creator>刘慈欣</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="insert" href="text/insert.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig" href="images/fig%201.png" media-type="image/png"/>
    <item id="orphan" href="images/orphan.png" media-type="image/png"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="nav" linear="no"/>
    <itemref idref="insert"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

const NAV = xhtml(`<nav epub:type="toc"><h1>目录</h1><ol>
  <li><a href="text/ch1.xhtml">第一章 科学边界</a></li>
  <li><a href="text/ch2.xhtml#s">第二章 &amp; 台球</a></li>
</ol></nav>`);

const COVER_JPEG = fakeJpeg('cover');
const FIGURE_PNG = fakePng('figure');

function epub3(): Buffer {
  return makeEpub({
    'OEBPS/content.opf': EPUB3_OPF,
    'OEBPS/nav.xhtml': NAV,
    'OEBPS/cover.xhtml': xhtml(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <image xlink:href="images/cover.jpg" width="600" height="800"/></svg>`),
    'OEBPS/text/insert.xhtml': xhtml('<div><img src="../images/orphan.png" alt=""/></div>'),
    'OEBPS/text/ch1.xhtml': xhtml(`<h1>第一章</h1>
      <p>　　汪淼觉得，&ldquo;科学边界&rdquo;&hellip;&hellip;</p>
      <p><img src="../images/fig%201.png" alt="插图"/></p>`),
    'OEBPS/text/ch2.xhtml': xhtml(`<h2 id="s">台球</h2>
      <p>A &amp; B &lt;tag&gt; &#x4E2D;&#25991;</p>
      <p><img src="../images/missing.png" alt="缺"/>缺图</p>`),
    'OEBPS/images/cover.jpg': COVER_JPEG,
    'OEBPS/images/fig 1.png': FIGURE_PNG,
    'OEBPS/images/orphan.png': fakePng('orphan'),
    'OEBPS/style.css': 'p { margin: 0 }',
  });
}

test('EPUB3：元数据、nav 目录标题、cover-image 封面、插图、中文和实体都对', () => {
  const book = parseBook({ fileName: 'santi.epub', bytes: epub3() });
  assertWellFormed(book);
  assert.equal(book.format, 'epub');
  assert.equal(book.title, '三体');
  assert.equal(book.author, '刘慈欣');
  assert.equal(book.language, 'zh-CN');
  assert.equal(book.cover?.mime, 'image/jpeg');
  assert.deepEqual(book.cover?.bytes, COVER_JPEG);
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['第一章 科学边界', '第二章 & 台球']);
  const figure = book.images.find((image) => image.bytes.equals(FIGURE_PNG));
  assert.ok(figure !== undefined);
  assert.equal(figure.mime, 'image/png');
  assert.equal(book.chapters[0]?.html,
    `<h2>第一章</h2><p>汪淼觉得，“科学边界”……</p><p><img data-asset="${figure.key}" alt="插图"></p>`);
  assert.equal(book.chapters[0]?.text, '第一章汪淼觉得，“科学边界”……');
  assert.equal(book.chapters[1]?.html, '<h2>台球</h2><p>A &amp; B &lt;tag&gt; 中文</p><p>缺图</p>');
});

test('EPUB3：没有文字的封面页和插页跳过，插页里的图片不进 images', () => {
  const book = parseBook({ fileName: 'santi.epub', bytes: epub3() });
  assert.equal(book.images.length, 2);
  assert.ok(book.images.some((image) => image.key === book.cover?.key));
  assert.ok(!book.chapters.some((chapter) => chapter.title === '目录'));
});

const EPUB2_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>  旧 书  </dc:title>
    <dc:creator opf:role="aut">甲</dc:creator>
    <dc:creator opf:role="aut">乙</dc:creator>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-image" href="Images/c.png" media-type="image/png"/>
    <item id="a" href="Text/a.html" media-type="application/xhtml+xml"/>
    <item id="b" href="Text/b.html" media-type="application/xhtml+xml"/>
    <item id="c" href="Text/c.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="a"/>
    <itemref idref="b"/>
    <itemref idref="c"/>
  </spine>
</package>`;

const NCX = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="p1" playOrder="1"><navLabel><text>序 章</text></navLabel><content src="Text/a.html"/></navPoint>
  </navMap>
</ncx>`;

function gbkChapter(): Buffer {
  return Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="GBK"?><html><body><p>'),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    Buffer.from('</p></body></html>'),
  ]);
}

test('EPUB2：NCX 目录、meta 封面、多位作者、没有目录项时用第一个标题或「第 N 章」，GBK 声明的章节能解码', () => {
  const cover = fakePng('old-cover');
  const book = parseBook({
    fileName: 'old.epub',
    bytes: makeEpub({
      'META-INF/container.xml': `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
      'content.opf': EPUB2_OPF,
      'toc.ncx': NCX,
      'Images/c.png': cover,
      'Text/a.html': '<html><body><p>序章正文</p></body></html>',
      'Text/b.html': '<html><body><h3>小标题</h3><p>正文二</p></body></html>',
      'Text/c.html': gbkChapter(),
    }),
  });
  assertWellFormed(book);
  assert.equal(book.title, '旧 书');
  assert.equal(book.author, '甲、乙');
  assert.equal(book.language, null);
  assert.deepEqual(book.cover?.bytes, cover);
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['序 章', '小标题', '第 3 章']);
  assert.equal(book.chapters[2]?.text, '中文');
});

test('EPUB：没有元数据标题时用文件名（去掉扩展名）作书名', () => {
  const opf = EPUB2_OPF.replace(/<dc:title>.*<\/dc:title>/, '');
  const book = parseBook({
    fileName: 'C:\\下载\\无名.EPUB',
    bytes: makeEpub({ 'OEBPS/content.opf': opf, 'OEBPS/Text/a.html': '<p>x</p>' }),
  });
  assert.equal(book.title, '无名');
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['第 1 章']);
});

const encryption = (algorithm: string, uri: string): string => `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
  xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="${algorithm}"/>
    <enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`;

test('EPUB：encryption.xml 里有真正的加密算法时报 drm，提示用没加密的版本', () => {
  const bytes = makeEpub({
    'META-INF/encryption.xml': encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc', 'OEBPS/text/ch1.xhtml'),
    'OEBPS/content.opf': EPUB3_OPF,
    'OEBPS/text/ch1.xhtml': xhtml('<p>密文</p>'),
  });
  assert.equal(code(() => parseBook({ fileName: 'locked.epub', bytes })), 'drm');
  assert.throws(() => parseBook({ fileName: 'locked.epub', bytes }), /DRM.*请用没有加密的版本/);
});

test('EPUB：只有字体混淆的 encryption.xml 照常解析', () => {
  for (const algorithm of ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']) {
    const bytes = makeEpub({
      'META-INF/encryption.xml': encryption(algorithm, 'OEBPS/fonts/a.otf'),
      'OEBPS/content.opf': EPUB3_OPF,
      'OEBPS/text/ch1.xhtml': xhtml('<p>正文</p>'),
    });
    const book = parseBook({ fileName: 'font.epub', bytes });
    assertWellFormed(book);
    assert.equal(book.chapters[0]?.text, '正文');
  }
});

test('EPUB：坏 ZIP、缺 container 或 OPF、spine 为空都报 corrupt；只有空页面报 empty', () => {
  assert.equal(code(() => parseBook({ fileName: 'bad.epub', bytes: Buffer.from('PK\u0003\u0004garbage') })), 'corrupt');
  const noContainer = makeZip([{ name: 'mimetype', data: 'application/epub+zip', store: true }]);
  assert.equal(code(() => parseBook({ fileName: 'a.epub', bytes: noContainer })), 'corrupt');
  assert.equal(code(() => parseBook({ fileName: 'a.epub', bytes: makeEpub({}) })), 'corrupt');
  const noSpine = EPUB3_OPF.replace(/<spine>[\s\S]*<\/spine>/, '<spine></spine>');
  assert.equal(code(() => parseBook({ fileName: 'a.epub', bytes: makeEpub({ 'OEBPS/content.opf': noSpine }) })),
    'corrupt');
  const blank = makeEpub({ 'OEBPS/content.opf': EPUB3_OPF, 'OEBPS/text/ch1.xhtml': xhtml('<p> </p>') });
  assert.equal(code(() => parseBook({ fileName: 'a.epub', bytes: blank })), 'empty');
});

test('EPUB：杂乱的章节标记规范化后，每章都满足标签、属性、块间无空白和 html↔text 一致', () => {
  const pixel = fakePng('inline-data').toString('base64');
  const messy = `
    <div class="chapter"><h1 class="t">  第三章&#12288;乱&nbsp;码 </h1>
      <div><div>　　<span style="x">缩进</span>的段落<br/><br/>换行后<b>粗<i>斜</b>体</i></div></div>
      <table><tr><td>名</td><td> 值 </td></tr><tr><th>a&lt;b</th><td>"引号"</td></tr></table>
      <ul><li><p>项一</p><ol><li>嵌套</li></ol></li><li>项二<blockquote>里面</blockquote></li></ul>
      <blockquote><p>引一</p><div>引二<h3>引里的标题</h3></div></blockquote>
      <pre>
  code &amp; more
    indented</pre>
      <p><ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby><sub>2</sub><sup>3</sup><a href="#n1">注</a></p>
      <p><img src="data:image/png;base64,${pixel}" alt="内嵌"/><img src="http://example.com/x.png"/></p>
      <hr/><p>　　</p><p>&#0;尾声 &amp;&amp; 结束\u000b</p>
    </div>`;
  const book = parseBook({
    fileName: 'messy.epub',
    bytes: makeEpub({ 'OEBPS/content.opf': EPUB3_OPF, 'OEBPS/nav.xhtml': NAV, 'OEBPS/text/ch1.xhtml': xhtml(messy) }),
  });
  assertWellFormed(book);
  assert.equal(book.chapters.length, 1);
  const chapter = book.chapters[0];
  assert.equal(chapter?.title, '第一章 科学边界');
  assert.ok(chapter?.html.startsWith('<h2>第三章　乱 码</h2><p>缩进的段落<br>换行后<strong>粗<em>斜</em></strong><em>体</em></p>'));
  assert.ok(chapter?.html.includes('<pre>  code &amp; more\n    indented</pre>'));
  assert.ok(chapter?.text.endsWith('尾声 && 结束'));
  assert.equal(book.images.filter((image) => image.bytes.equals(fakePng('inline-data'))).length, 1);
});
