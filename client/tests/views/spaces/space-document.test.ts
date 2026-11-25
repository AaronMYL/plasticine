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

describe('Report', () => {
  it('quote paragraph indices match server source without double-numbering nested paragraphs', () => {
    const html = '<section id="one"><h2>标题</h2><p>一<b>段</b></p><blockquote><p>引文</p></blockquote></section>';
    const prepared = prepareSpace({ html, genre: 'report', title: '报告', dateLabel: '' });
    const numbered = [...frameBody(prepared.body).querySelectorAll<HTMLElement>('[data-qp]')];
    expect(numbered.map((element) => ({ paragraph: Number(element.dataset.qp),
      sectionId: element.closest('section[id]')?.id ?? null, text: element.textContent })))
      .toEqual(spaceParagraphs(html));
  });
  it('numbers editable text only, puts headline on top, and adds TOC via data-toc for >= 3 sections', () => {
    const prepared = prepareSpace({ html: REPORT, genre: 'report', title: '周报', dateLabel: '' });
    const doc = frameBody(prepared.body);
    const numbered = [...doc.querySelectorAll('[data-e]')].map((element) => element.textContent);
    expect(numbered).toEqual(['学会识别会改变神经表征。', '先看结论：两项进展', '第一段。', '本期研究', '一粗', '来源',
      '第三段。']);
    expect(prepared.editable).toBe(7);
    expect(doc.querySelector('figure.ch')?.classList.contains('pz-fixed')).toBe(true);
    expect(doc.querySelector('.rp-stats')?.classList.contains('pz-fixed')).toBe(true);
    expect(doc.querySelector('.rp > header.rp-hero:first-child')).not.toBeNull();
    expect(doc.querySelector('.rp > header.rp-hero + .rp-stats'), '旧报告块里的数字条挪到大标题下面').not.toBeNull();
    const toc = [...doc.querySelectorAll('.rp-nav a')].map((link) => [link.textContent, link.getAttribute('href')]);
    expect(toc).toEqual([['先看结论', '#a'], ['本期研究', '#b'], ['来源', '#c']]);
    expect(doc.querySelector('.rp-nav')?.nextElementSibling?.id, '目录在第一节前面').toBe('a');
  });

  it('new layout places source above title, metric bar below in order, and TOC before first section', () => {
    const html = '<p class="rp-kick"><b>研究快照 · 第 3 期</b><span>资料截至 10 月 9 日</span></p>'
      + '<header class="rp-hero"><div><h1 class="rp-h1">别追<em>风口</em></h1><p class="rp-deck">导语</p></div>'
      + '<aside class="rp-brief"><p class="lb">核心判断</p><p>一句</p></aside></header>'
      + '<div class="rp-stats"><div class="rp-stat"><div class="v"><b>$169</b></div>'
      + '<div class="l">中位数</div></div></div>'
      + ['一', '二', '三'].map((name, index) => `<section class="rp-sec" id="s${index}"><div class="rp-sh">`
        + `<span class="no">0${index + 1} / ${name}</span><h2>${name}</h2></div><p>正文</p></section>`).join('');
    const doc = frameBody(prepareSpace({ html, genre: 'report', title: '研究', dateLabel: '' }).body);
    expect([...doc.querySelectorAll('.rp > *')].map((element) => element.className))
      .toEqual(['rp-kick', 'rp-hero', 'rp-stats pz-fixed', 'rp-nav', 'rp-sec', 'rp-sec', 'rp-sec']);
  });

  it('omits TOC under 3 sections and swaps Plasticine asset images with injected ones', () => {
    const prepared = prepareSpace({ html: '<p>一段。</p><img src="/v2/notes/assets/a.webp" alt="图">'
      + '<img src="data:image/png;base64,AA" alt="内嵌">', genre: 'report', title: '核查', dateLabel: '' });
    const doc = frameBody(prepared.body);
    expect(doc.querySelector('.rp-nav')).toBeNull();
    const asset = doc.querySelector('img[alt="图"]');
    expect([asset?.getAttribute('src'), asset?.getAttribute('data-pz-asset')])
      .toEqual([null, '/v2/notes/assets/a.webp']);
    expect(doc.querySelector('img[alt="内嵌"]')?.getAttribute('src')).toBe('data:image/png;base64,AA');
  });

  it('editing a paragraph replaces it in unscripted source and saves body without indices', () => {
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

describe('Letter', () => {
  it('letterhead renders date, title, body, and badged Plasticine signature', () => {
    const prepared = prepareSpace({ html: '<p class="lt-lead">你定的「做梦」。</p><p>下一步。</p>', genre: 'letter',
      title: '做梦，有了一组数字', dateLabel: '2026 年 11 月 9 日' });
    const doc = frameBody(prepared.body);
    expect(doc.querySelector('.lt > .lt-date')?.textContent).toBe('2026 年 11 月 9 日');
    expect(doc.querySelector('.lt > h1.lt-title')?.textContent).toBe('做梦，有了一组数字');
    expect(doc.querySelector('.lt-body > p.lt-lead')?.getAttribute('data-e')).toBe('0');
    expect(doc.querySelector('.lt-sign')?.textContent).toBe('— Plasticine');
    expect(doc.querySelector('.lt-sign svg.plasticine-mark')).not.toBeNull();
    expect(doc.querySelector('.lt-title')?.hasAttribute('data-e')).toBe(false);
  });

  it('signature uses main thread\'s current name and avatar', () => {
    const prepared = prepareSpace({ html: '<p class="lt-lead">一段。</p>', genre: 'letter', title: '信',
      dateLabel: '2026 年 11 月 14 日', signer: { name: '卷毛', mark: '<svg class="bot-still"></svg>' } });
    const doc = frameBody(prepared.body);
    expect(doc.querySelector('.lt-sign')?.textContent).toBe('— 卷毛');
    expect(doc.querySelector('.lt-sign svg.bot-still')).not.toBeNull();
    expect(doc.querySelector('.lt-sign svg.plasticine-mark')).toBeNull();
  });

  it('legacy letter swaps caption to star badge on image and hides model-drawn line art', () => {
    const html = '<p class="lt-lead">一段。</p>'
      + '<figure class="lt-fig"><img src="/v2/notes/assets/a.webp" alt="图">'
      + '<figcaption>夜里回看原话。<span class="lt-credit">Plasticine 生成</span></figcaption></figure>'
      + '<figure class="lt-fig"><svg class="lt-draw" viewBox="0 0 600 300"><path d="M0 0"/></svg>'
      + '<figcaption>Plasticine 原创线稿</figcaption></figure><p>正文。</p>';
    const prepared = prepareSpace({ html, genre: 'letter', title: '信', dateLabel: '' });
    const doc = frameBody(prepared.body);
    expect(doc.body.textContent).not.toContain('Plasticine 生成');
    expect(doc.body.textContent).not.toContain('原创线稿');
    expect(doc.querySelectorAll('figure.lt-fig')).toHaveLength(1);
    expect(doc.querySelector('figure.lt-fig > .lt-ai')?.getAttribute('aria-label')).toBe('AI 生成');
    expect(doc.querySelector('figure.lt-fig figcaption')?.textContent).toBe('夜里回看原话。');
    expect(applySpaceEdit(prepared, 3, '正文改过。')).toContain('Plasticine 生成');
  });
});

describe('Legacy layout thumbnail', () => {
  it('composes report lead with issue number, takeaway, metric cards, and first section', () => {
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
  it('CSP allows inline styles/scripts and data:/blob: images offline with tokens and runtime', () => {
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

describe('Timestamp below card', () => {
  it('uses unified card time (time today, Yesterday, M-D, with year) while letter uses prose date', async () => {
    const { bodyDate, timeText } = await import('../../../src/shell/time-text.ts');
    const now = new Date('2026-11-09T10:00:00+08:00');
    expect(timeText('2026-11-09T00:30:00Z', now, 'Asia/Shanghai')).toBe('08:30');
    expect(timeText('2026-11-08T13:07:00Z', now, 'Asia/Shanghai')).toBe('昨天');
    expect(timeText('2026-11-01T13:07:00Z', now, 'Asia/Shanghai')).toBe('11-01');
    expect(timeText('2025-11-01T13:07:00Z', now, 'Asia/Shanghai')).toBe('2025-11-01');
    expect(bodyDate('2026-11-09T00:30:00Z', now, 'Asia/Shanghai')).toBe('11 月 9 日');
  });
});
