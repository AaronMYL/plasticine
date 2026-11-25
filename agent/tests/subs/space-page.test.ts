import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spaceHtmlText } from '../../shared/space-html.ts';
import { followTexts, pageSummary, sanitizeSpaceHtml } from '../../src/subs/index.ts';
import { checkSpacePage, dropDeadMessageLinks } from '../../src/subs/space-page.ts';
import { illustrate } from '../../src/subs/illustrate.ts';

test('Sanitizer strips external scripts, iframe/object/embed/form/base/meta/link', () => {
  const dirty = '<html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://x/">'
    + '<link rel="stylesheet" href="https://x/a.css"></head><body>'
    + '<p>正文</p><script src="https://cdn.example/a.js"></script><iframe src="https://x">里面</iframe>'
    + '<object data="a.swf"><param name="a"></object><embed src="a.swf">'
    + '<form action="https://x"><input name="q"><button formaction="https://y">发</button></form>'
    + '</body></html>';
  const { html, removed } = sanitizeSpaceHtml(dirty);
  assert.equal(html, '<p>正文</p><input name="q"><button>发</button>');
  assert.deepEqual(removed.sort(), ['base 元素 1 处', 'embed 元素 1 处', 'iframe 元素 1 处', 'link 元素 1 处',
    'meta 元素 1 处', 'object 元素 1 处', '外链脚本 1 处', '属性 formaction 1 处', '表单 1 处']
    .sort());
});

test('Sanitizer keeps inline svg/style/script/on* for sandbox and strips @import', () => {
  const page = '<style>@import url(https://x/a.css);.a{color:var(--fg)}</style>'
    + '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"></linearGradient></defs>'
    + '<rect width="5" height="5" fill="var(--hue-sky)"/><text x="1" y="9">4%</text></svg>'
    + '<div class="seg"><button data-filter="深读" onclick="pick(this)">深读</button></div>'
    + '<script>function pick(b){b.classList.add("on")}</script>';
  const { html, removed } = sanitizeSpaceHtml(page);
  assert.equal(html, page.replace('@import url(https://x/a.css);', '').replace('/>', ' />'));
  assert.deepEqual(removed, []);
});

test('Sanitizer allows http/mailto/hash links, strips javascript:, allows own/data img', () => {
  const { html, removed } = sanitizeSpaceHtml('<a href="java\tscript:alert(1)">坏</a><a href="https://a.b/c">好</a>'
    + '<a href="#sec">锚</a><a data-link="project:p-1">项目</a><img src="https://x/a.png" alt="外">'
    + '<img src="/v2/notes/assets/abc.webp" alt="插图"><img src="data:image/png;base64,AAAA" alt="内嵌">'
    + '<a href="#x" target="_blank" contenteditable="true" data-e="3">t</a>');
  assert.equal(html, '<a>坏</a><a href="https://a.b/c">好</a><a href="#sec">锚</a><a data-link="project:p-1">项目</a>'
    + '<img alt="外"><img src="/v2/notes/assets/abc.webp" alt="插图"><img src="data:image/png;base64,AAAA" alt="内嵌">'
    + '<a href="#x">t</a>');
  assert.deepEqual(removed.sort(), ['不安全的链接 1 处', '外链图片或媒体（只能用 Plasticine 自己的资产或 data: 图） 1 处',
    '属性 target 1 处'].sort());
});

test('Sanitizer ignores </div> inside scripts and re-escapes quotes/angles in attrs', () => {
  const { html } = sanitizeSpaceHtml('<script>const s = "<div>" + "</div>";</script>'
    + '<p title="a &quot;b&quot; <c>">x</p>');
  assert.equal(html, '<script>const s = "<div>" + "</div>";</script><p title="a &quot;b&quot; &lt;c>">x</p>');
});

test('Plain text extracts visible text excluding script/style with breaks and entities', () => {
  assert.equal(spaceHtmlText('<style>.a{}</style><h1>学会识别&amp;改变</h1><p>输入<b>没变</b></p>'
    + '<script>var x="不算"</script><ul><li>一</li><li>二</li></ul>'), '学会识别&改变\n输入没变\n一\n二');
});

test('Brief extracts h1 and up to 4 metrics for report, title for letter, fallback title', () => {
  const report = '<header class="rp-hero"><h1 class="rp-h1">学会识别会改变神经表征。</h1><div class="rp-stats">'
    + '<div class="rp-stat"><div class="v"><b>2</b><i>篇</i></div>'
    + '<div class="l"><span class="sq"></span>原文深读</div></div>'
    + '<div class="rp-stat"><div class="v"><b>1</b><i>篇</i></div><div class="l">已同行评审</div></div></div></header>';
  assert.deepEqual(pageSummary('周报', 'report', report), { headline: '学会识别会改变神经表征。',
    stats: [{ value: '2 篇', label: '原文深读' }, { value: '1 篇', label: '已同行评审' }] });
  assert.deepEqual(pageSummary('做梦，有了一组数字', 'letter', '<p class="lt-lead">你定的「做梦」有了一组数字。</p>'),
    { headline: '做梦，有了一组数字', stats: [] });
  assert.equal(pageSummary('核查', 'report', '<p>没有大标题的一页正文。</p>').headline, '核查');
});

test('Extracts follow-up items marked with data-follow attribute', () => {
  assert.deepEqual(followTexts('<p>不算</p><ul><li data-follow>把<b>验收</b>一节写完</li><li data-follow="">约赵一舟聊合作</li>'
    + '</ul><p data-follow>今晚我先拿《我的理论用词》试一次。</p>'),
  ['把验收一节写完', '约赵一舟聊合作', '今晚我先拿《我的理论用词》试一次。']);
});

const LETTER = '<p class="lt-lead">开头。</p><figure class="lt-fig" data-illustrate="夜里，散落的便签被连成一张整齐的网">'
  + '<figcaption>夜里回看原话。</figcaption></figure><p>正文。</p>'
  + '<figure class="lt-fig" data-illustrate="第二张"><figcaption>多余的</figcaption></figure>';

test('Letter illustration generates asset with star badge and drops extra placeholders', async () => {
  const prompts: string[] = [];
  const saved: string[] = [];
  const result = await illustrate(LETTER, { signal: new AbortController().signal,
    illustrator: { draw: async (prompt) => {
      prompts.push(prompt);
      return { data: Buffer.from('img'), mime: 'image/webp' };
    } },
    save: (data, mime) => {
      saved.push(`${data.toString()}:${mime}`);
      return 'abc.webp';
    } });
  assert.deepEqual(prompts, ['夜里，散落的便签被连成一张整齐的网']);
  assert.deepEqual(saved, ['img:image/webp']);
  assert.deepEqual(result.outcome, { asset: 'abc.webp' });
  assert.equal(result.html, '<p class="lt-lead">开头。</p><figure class="lt-fig">'
    + '<img src="/v2/notes/assets/abc.webp" alt="夜里，散落的便签被连成一张整齐的网">'
    + '<span class="lt-ai" role="img" aria-label="AI 生成" title="AI 生成"></span>'
    + '<figcaption>夜里回看原话。</figcaption></figure><p>正文。</p>');
});

test('Letter drops illustration cleanly and still writes when image model unavailable', async () => {
  const none = await illustrate(LETTER, { illustrator: null, save: () => 'x', signal: new AbortController().signal });
  assert.equal(none.html, '<p class="lt-lead">开头。</p><p>正文。</p>');
  assert.deepEqual(none.outcome, { skipped: '这台 Plasticine 没有能出图的模型' });
  const failed = await illustrate(LETTER, { illustrator: { draw: async () => ({ error: '出图额度用完了' }) },
    save: () => 'x', signal: new AbortController().signal });
  assert.deepEqual(failed.outcome, { skipped: '出图额度用完了' });
  assert.doesNotMatch(failed.html, /figure/);
  const plain = await illustrate('<p>没有占位</p>', { illustrator: null, save: () => 'x',
    signal: new AbortController().signal });
  assert.equal(plain.outcome, null);
});

test('Strips broken/forged/deleted chat citation links while keeping visible text', () => {
  const live = new Set(['line:main:12']);
  const html = '<blockquote class="lt-quote">先把框架读懂。<cite><a data-link="message:line:main:12">11 月 12 日</a>'
    + '</cite></blockquote><p>见<a data-link="message:line:main:999">这段原话</a>，'
    + '<a data-link=\'message:乱写的\'>还有一段</a>和<a data-link="project:p1">项目</a>。</p>';
  assert.equal(dropDeadMessageLinks(html, (ref) => live.has(ref)),
    '<blockquote class="lt-quote">先把框架读懂。<cite><a data-link="message:line:main:12">11 月 12 日</a>'
    + '</cite></blockquote><p>见这段原话，还有一段和<a data-link="project:p1">项目</a>。</p>');
});

test('Scrubs credential-like URL params in letters while leaving report URLs verbatim', () => {
  const link = 'https://www.xiaohongshu.com/explore/6614a2b3000000001a0123ab?xsec_token=AB123%3D&amp;page=2';
  const page = `<p class="lt-lead">今天看到一篇 <a href="${link}">笔记</a>，原文在 ${link} 。</p>`
    + '<p>第二段，写满一些字，免得被当成空的正文。第二段，写满一些字，免得被当成空的正文。</p>';
  const letter = checkSpacePage('letter', page).html;
  assert.equal(letter.includes('xsec_token'), false);
  assert.ok(letter.includes('https://www.xiaohongshu.com/explore/6614a2b3000000001a0123ab?page=2'));
  const report = checkSpacePage('report', `<h1>报告</h1>${page}`).html;
  assert.ok(report.includes('xsec_token=AB123%3D'));
});
