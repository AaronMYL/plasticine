// 空间网页进 iframe 之前（第 8 批第 6 条）：给能改的字编号（图表、数字条不编）、插图换成外面传进去的、套信纸和目录；
// ✎ 改了一段，在没跑过脚本的原样上换掉再存，编号不进存下来的正文；还有沙盒里的那份 srcdoc 的 CSP。
import { describe, expect, it } from 'vitest';
import { composeSpaceDocument, SPACE_CSP } from '../../../src/views/spaces/space-compose.ts';
import { applySpaceEdit, legacyPreviewHtml, prepareSpace } from '../../../src/views/spaces/space-document.ts';
import { spaceParagraphs } from '../../../../agent/shared/space-selection.ts';

const REPORT = '<header class="rp-hero"><h1 class="rp-h1">学会识别会改变神经表征。</h1>'
  + '<div class="rp-stats"><div class="rp-stat"><div class="v"><b>2</b></div><div class="l">原文深读</div></div></div>'
  + '</header>'
  + '<section class="rp-sec" id="a" data-toc="先看结论"><h2>先看结论：两项进展</h2><p>第一段。</p>'
  + '<figure class="ch"><figcaption class="ch-h"><b>识别比例</b></figcaption><p class="ch-src">来源 [1]</p></figure>'
  + '</section><section class="rp-sec" id="b"><h2>本期研究</h2><ul><li>一<b>粗</b></li></ul></section>'
  + '<section class="rp-sec" id="c"><h2>来源</h2><p>第三段。</p></section>'
  + '<script>document.querySelector("p").textContent = "脚本改过的"</script>';

function frameBody(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('报告', () => {
  it('引用段落编号与服务端原文一致，嵌套段落不会重复编号', () => {
    const html = '<section id="one"><h2>标题</h2><p>一<b>段</b></p><blockquote><p>引文</p></blockquote></section>';
    const prepared = prepareSpace({ html, genre: 'report', title: '报告', dateLabel: '' });
    const numbered = [...frameBody(prepared.body).querySelectorAll<HTMLElement>('[data-qp]')];
    expect(numbered.map((element) => ({ paragraph: Number(element.dataset.qp),
      sectionId: element.closest('section[id]')?.id ?? null, text: element.textContent }))).toEqual(spaceParagraphs(html));
  });
  it('能改的字编号，图表和数字条不编；结论大标题在最上，3 节以上配目录（data-toc 是目录里的名字）', () => {
    const prepared = prepareSpace({ html: REPORT, genre: 'report', title: '周报', dateLabel: '' });
    const doc = frameBody(prepared.body);
    const numbered = [...doc.querySelectorAll('[data-e]')].map((element) => element.textContent);
    expect(numbered).toEqual(['学会识别会改变神经表征。', '先看结论：两项进展', '第一段。', '本期研究', '一粗', '来源',
      '第三段。']);
    expect(prepared.editable).toBe(7);
    expect(doc.querySelector('figure.ch')?.classList.contains('pz-fixed')).toBe(true);
    expect(doc.querySelector('.rp-stats')?.classList.contains('pz-fixed')).toBe(true);
    expect(doc.querySelector('.rp > header.rp-hero')).not.toBeNull();
    const toc = [...doc.querySelectorAll('.rp-toc a')].map((link) => [link.textContent, link.getAttribute('href')]);
    expect(toc).toEqual([['先看结论', '#a'], ['本期研究', '#b'], ['来源', '#c']]);
  });

  it('不到 3 节不配目录；插图（Plasticine 自己的资产）换成外面传进去的', () => {
    const prepared = prepareSpace({ html: '<p>一段。</p><img src="/v2/notes/assets/a.webp" alt="图">'
      + '<img src="data:image/png;base64,AA" alt="内嵌">', genre: 'report', title: '核查', dateLabel: '' });
    const doc = frameBody(prepared.body);
    expect(doc.querySelector('.rp-toc')).toBeNull();
    expect(doc.querySelector('.rp-body')?.classList.contains('no-toc')).toBe(true);
    const asset = doc.querySelector('img[alt="图"]');
    expect([asset?.getAttribute('src'), asset?.getAttribute('data-pz-asset')])
      .toEqual([null, '/v2/notes/assets/a.webp']);
    expect(doc.querySelector('img[alt="内嵌"]')?.getAttribute('src')).toBe('data:image/png;base64,AA');
  });

  it('改了一段：在没跑过脚本的原样上换掉，存下来的正文不带编号', () => {
    const prepared = prepareSpace({ html: REPORT, genre: 'report', title: '周报', dateLabel: '' });
    const saved = applySpaceEdit(prepared, 2, '第一段<b>改过</b>。');
    expect(saved).toContain('<p>第一段<b>改过</b>。</p>');
    expect(saved).not.toContain('data-e');
    expect(saved).not.toContain('pz-fixed');
    expect(saved).toContain('<script>document.querySelector("p").textContent = "脚本改过的"</script>');
    expect(applySpaceEdit(prepared, 6, '第三段改过。')).toContain('<p>第一段<b>改过</b>。</p>');
    expect(() => applySpaceEdit(prepared, 99, 'x')).toThrow(/第 99 段/);
  });
});

describe('来信', () => {
  it('信纸：日期、题目、正文、署名 Plasticine（带标记）', () => {
    const prepared = prepareSpace({ html: '<p class="lt-lead">你定的「做梦」。</p><p>下一步。</p>', genre: 'letter',
      title: '做梦，有了一组数字', dateLabel: '2026 年 11 月 9 日' });
    const doc = frameBody(prepared.body);
    expect(doc.querySelector('.lt > .lt-date')?.textContent).toBe('2026 年 11 月 9 日');
    expect(doc.querySelector('.lt > h1.lt-title')?.textContent).toBe('做梦，有了一组数字');
    expect(doc.querySelector('.lt-body > p.lt-lead')?.getAttribute('data-e')).toBe('0');
    expect(doc.querySelector('.lt-sign')?.textContent).toBe('Plasticine');
    expect(doc.querySelector('.lt-sign svg.plasticine-mark')).not.toBeNull();
    expect(doc.querySelector('.lt-title')?.hasAttribute('data-e')).toBe(false);
  });
});

describe('旧版式的缩略图', () => {
  it('拼一页报告的开头：期号、结论、数字卡、第一节', () => {
    const html = legacyPreviewHtml({ kicker: '第 2 期', headline: '睡眠中的记忆重放', stats: [{ value: '14', label: '篇' }],
      blocks: [{ type: 'heading', id: 'a', text: '本周概览' }, { type: 'text', markdown: '**重放**越多越好。' }],
      sources: [] }, '周报');
    const doc = frameBody(html);
    expect(doc.querySelector('.rp-kick')?.textContent).toBe('第 2 期');
    expect(doc.querySelector('h1')?.textContent).toBe('睡眠中的记忆重放');
    expect(doc.querySelector('.rp-stat .v b')?.textContent).toBe('14');
    expect(doc.querySelector('h2')?.textContent).toBe('本周概览');
  });
});

describe('srcdoc', () => {
  it('CSP 只放行内联样式和脚本、data: / blob: 图，不连网；令牌、版式底子和运行时都在里面', () => {
    const doc = composeSpaceDocument({ body: '<p>正文</p>', genre: 'letter', mode: 'page',
      tokens: { '--bg': '#2b2826' }, dark: true });
    expect(SPACE_CSP).toContain("connect-src 'none'");
    expect(SPACE_CSP).toContain("default-src 'none'");
    expect(SPACE_CSP).toContain('img-src data: blob:');
    expect(SPACE_CSP).not.toMatch(/https?:/);
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${SPACE_CSP}">`);
    expect(doc).toContain('--bg:#2b2826');
    expect(doc).toContain('color-scheme:dark');
    expect(doc).toContain('.lt-title{');
    expect(doc).toContain('("page")');
    expect(doc).toContain('<body class="pz-letter pz-wait"><p>正文</p></body>');
    expect(composeSpaceDocument({ body: '', genre: 'report', mode: 'thumb', tokens: {}, dark: false }))
      .toContain('class="pz-report pz-wait pz-thumb"');
  });
});

describe('卡片下面的时间', () => {
  it('今天写时分、昨天写「昨天」、今年写月日、更早带年份；信纸日期', async () => {
    const { letterDate, spaceWhen } = await import('../../../src/views/spaces/space-time.ts');
    const now = new Date('2026-11-09T10:00:00+08:00');
    expect(spaceWhen('2026-11-09T00:30:00Z', now, 'Asia/Shanghai')).toBe('今天 08:30');
    expect(spaceWhen('2026-11-08T13:07:00Z', now, 'Asia/Shanghai')).toBe('昨天 21:07');
    expect(spaceWhen('2026-11-01T13:07:00Z', now, 'Asia/Shanghai')).toBe('11月1日');
    expect(spaceWhen('2025-11-01T13:07:00Z', now, 'Asia/Shanghai')).toBe('2025年11月1日');
    expect(letterDate('2026-11-09T00:30:00Z', 'Asia/Shanghai')).toBe('2026 年 11 月 9 日');
  });
});
