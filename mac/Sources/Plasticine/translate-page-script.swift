// 生成的文件，不要手改：改 client/src/mac/translate-page*.ts，再运行 node scripts/generate-translate-script.ts。
// 沉浸式翻译注入网页标签的脚本（Mac 0.4.0，第 2 批），由 web-translate.swift 装进网页标签的独立脚本世界。

enum TranslatePageScript {
    static let source = #"""
(() => {
if (window.__plasticineTranslator) return;
// 与翻译一样在标签的独立脚本环境中执行；只标已读取的字，不运行网页指令。

const MARK_ATTRIBUTE = 'data-plasticine-extract';
const SKIP = 'script,style,noscript,textarea,input,select,[contenteditable="true"],nav,footer,aside';
const MAX_IMAGES = 12;

function normalized(value        )         { return value.replace(/\s+/g, ' ').trim(); }

function clearMarks(doc          )       {
  for (const mark of doc.querySelectorAll(`[${MARK_ATTRIBUTE}]`)) {
    const parent = mark.parentNode;
    mark.replaceWith(...mark.childNodes);
    parent?.normalize();
  }
}

function textMap(root         , doc          ) {
  const walker = doc.createTreeWalker(root, 4);
  const positions                                   = [];
  let text = '';
  let next             ;
  while ((next = walker.nextNode()) !== null) {
    const node = next        ;
    if (node.parentElement?.closest(SKIP) !== null) continue;
    for (let offset = 0; offset < node.data.length; offset += 1) {
      const char = node.data[offset] ;
      if (/\s/.test(char)) {
        if (text === '' || text.endsWith(' ')) continue;
        text += ' ';
      } else text += char;
      positions.push({ node, offset });
    }
  }
  return { text, positions };
}

function markPoint(doc          , point             , index        , color        )                     {
  const roots = [...doc.querySelectorAll('article p,main p,[role="main"] p,p,li,h1,h2,h3')];
  const quote = normalized(point.quote);
  const context = normalized(point.context);
  for (const root of roots) {
    if (root.closest(SKIP) !== null) continue;
    const mapped = textMap(root, doc);
    if (context !== '' && !mapped.text.includes(context)) continue;
    const start = mapped.text.indexOf(quote);
    if (start < 0) continue;
    const entries = mapped.positions.slice(start, start + quote.length);
    const nodes = new Map                                      ();
    for (const entry of entries) {
      const previous = nodes.get(entry.node);
      nodes.set(entry.node, { start: previous?.start ?? entry.offset, end: entry.offset + 1 });
    }
    let first                     = null;
    for (const [node, span] of nodes) {
      const range = doc.createRange();
      range.setStart(node, span.start);
      range.setEnd(node, span.end);
      const mark = doc.createElement('mark');
      mark.setAttribute(MARK_ATTRIBUTE, String(index));
      mark.style.backgroundColor = color;
      mark.style.color = 'inherit';
      range.surroundContents(mark);
      first ??= mark;
    }
    return first;
  }
  return null;
}

function extractPage(doc          , command                    )          {
  if (command.kind === 'extract_images') {
    const root = doc.querySelector('article,main,[role="main"]') ?? doc.body;
    const paragraphs = [...root.querySelectorAll('p,h1,h2,h3,li')];
    return [...root.querySelectorAll('img')].filter((image) => image.closest(SKIP) === null
      && (image.naturalWidth === 0 || image.naturalWidth >= 80)).flatMap((image) => {
      const raw = image.currentSrc || image.src || image.dataset['src'] || '';
      if (!/^https?:\/\//i.test(raw)) return [];
      const before = paragraphs.filter((paragraph) => Boolean(paragraph.compareDocumentPosition(image) & 4)).at(-1);
      return [{ url: raw, alt: (image.alt ?? '').slice(0, 500),
        afterText: normalized(before?.textContent ?? '').slice(-1000) }];
    }).slice(0, MAX_IMAGES);
  }
  clearMarks(doc);
  let marked = 0;
  for (const [index, point] of command.points.entries()) {
    const mark = markPoint(doc, point, index, command.color ?? 'Mark');
    if (mark === null) continue;
    marked += 1;
    if (command.focus === index) mark.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
  return { marked };
}

// 沉浸式翻译的切段规则（Mac 0.4.0，第 2 批）：哪些块能整段译、取出原文、判断是不是已经是目标语言。纯函数，只看 DOM，
// 不改页面。translate-page.ts 用它；scripts/generate-translate-script.ts 把这几份去掉类型后拼成一段注入网页标签。
// 自足：不引别的值（只能 import type）。

/** 这几个数和 agent/shared/api 里的上限一致（这里不能引值，测试核对两边一样）。 */
const PAGE_LIMITS = {
  /** 一批最多几段（TRANSLATE_BATCH_MAX_ITEMS）。 */
  batchItems: 24,
  /** 一批最多多少字（TRANSLATE_BATCH_MAX_CHARS）。 */
  batchChars: 12_000,
  /** 一段最多多少字（TRANSLATE_ITEM_MAX_CHARS）；更长的整块不译。 */
  itemChars: 4_000,
  /** 「问这一段」带上的原文、译文上限（TRANSLATE_ASK_MAX_CHARS）。 */
  askChars: 8_000,
};

const SKIP_SELECTOR = [
  'nav', 'button', 'input', 'textarea', 'select', 'option', 'code', 'pre', 'kbd', 'samp', 'script', 'style',
  'noscript', 'template', 'svg', 'math', 'canvas', 'video', 'audio', 'iframe', 'object', 'plasticine-tr',
  'plasticine-toolbar', '[contenteditable]:not([contenteditable="false"])', '[aria-hidden="true"]', '[hidden]',
  '[translate="no"]', '.notranslate', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="button"]', '[role="menu"]', '[role="menubar"]', '[role="toolbar"]', '[role="tablist"]', '[role="search"]',
  '[role="textbox"]', '[role="combobox"]', '[role="listbox"]',
].join(', ');
// 行内的标签：一个块里只有这些子元素，它就是一个能整段译的段落。
const INLINE_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'DATA', 'DEL', 'DFN', 'EM', 'FONT', 'I',
  'IMG', 'INS', 'MARK', 'Q', 'RP', 'RT', 'RUBY', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR',
  'WBR', 'LABEL', 'CODE', 'KBD', 'SAMP']);
// 这些块就算只有一个链接也译（博客目录的标题、表格里的链接）；别的块整段都在链接里就是菜单、用户名，不译。
const LINK_OK_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DT', 'DD', 'CAPTION']);
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
// 段落一类：一个词也译；别的容器（div 之类）至少两个词才译，免得把界面上的零碎字当正文。
const PROSE_TAGS = new Set(['P', 'LI', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION', 'SUMMARY',
  ...HEADING_TAGS]);
const CARD_FIELDS = 'input[autocomplete^="cc-" i], input[name*="cardnumber" i], input[name*="card_number" i], '
  + 'input[name*="cvv" i], input[name*="cvc" i]';
const ENGLISH_WORDS = new Set(['the', 'and', 'of', 'to', 'is', 'in', 'that', 'for', 'it', 'with', 'as', 'was', 'on',
  'are', 'be', 'this', 'by', 'you', 'not', 'or', 'have', 'from', 'but', 'what', 'an', 'they', 'we', 'can', 'will']);

function clip(text        , max        )         {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** 元素里的字，不算我们插进去的译文；<br> 和块之间当一个空格，连续空白并成一个。 */
function sourceText(element         )         {
  const parts           = [];
  const walk = (node      )       => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        parts.push(child.nodeValue ?? '');
      } else if (child.nodeType === 1) {
        const tag = (child           ).tagName;
        if (tag === 'PLASTICINE-TR' || tag === 'SCRIPT' || tag === 'STYLE') {
          continue;
        }
        if (tag === 'BR') {
          parts.push(' ');
          continue;
        }
        walk(child);
      }
    }
  };
  walk(element);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function letters(text        , script        )         {
  return (text.match(script) ?? []).length;
}

/** 这段是不是已经是目标语言：看 lang 属性，再看用的文字。 */
function alreadyTarget(text        , target        , lang        )          {
  const base = target.split('-')[0] ?? target;
  const declared = lang.toLowerCase();
  if (declared !== '' && declared.split('-')[0] === base) {
    return true;
  }
  const han = letters(text, /\p{Script=Han}/gu);
  const kana = letters(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = letters(text, /\p{Script=Hangul}/gu);
  const latin = letters(text, /\p{Script=Latin}/gu);
  const total = han + kana + hangul + latin;
  if (total === 0) {
    return true;
  }
  if (base === 'zh') {
    return kana === 0 && han / total >= 0.4;
  }
  if (base === 'ja') {
    return kana > 0 && (han + kana) / total >= 0.4;
  }
  if (base === 'ko') {
    return hangul / total >= 0.4;
  }
  if (latin / total < 0.6) {
    return false;
  }
  if (base === 'en') {
    const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
    const common = words.filter((word) => ENGLISH_WORDS.has(word)).length;
    return words.length >= 4 && common / words.length >= 0.15;
  }
  return false;
}

function inlineOnly(element         )          {
  for (const child of Array.from(element.children)) {
    if (child.tagName.startsWith('PLASTICINE-')) {
      continue;
    }
    if (!INLINE_TAGS.has(child.tagName) && !child.tagName.includes('-')) {
      return false;
    }
    if (!inlineOnly(child)) {
      return false;
    }
  }
  return true;
}

function skipped(element         )          {
  if (element.closest(SKIP_SELECTOR) !== null) {
    return true;
  }
  // 页面自己的页头页脚不译；文章里的 <header>（标题、署名）照译。
  const edge = element.closest('header, footer');
  return edge !== null && edge.closest('article, main') === null;
}

function linkOnly(element         , text        )          {
  const links = Array.from(element.querySelectorAll('a'));
  if (links.length === 0) {
    return false;
  }
  const linked = links.map((link) => sourceText(link)).join(' ').replace(/\s+/g, '');
  return linked.length >= text.replace(/\s+/g, '').length;
}

function wordy(element         , text        )          {
  const meaningful = letters(text, /[\p{L}]/gu);
  if (meaningful < 2) {
    return false;
  }
  if (PROSE_TAGS.has(element.tagName)) {
    return true;
  }
  return /\s/.test(text) || letters(text, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) >= 4;
}

/** 能整段译的块：只含行内元素、它的父元素不是（取最大的那一块）、不在跳过的区域里、字够多。 */
function isCandidate(element         )          {
  if (element.tagName === 'BODY' || element.tagName === 'HTML') {
    return false;
  }
  if (!inlineOnly(element) || skipped(element)) {
    return false;
  }
  // 父元素也只含行内元素时，整段该从父元素译（取最大的那一块）。
  const parent = element.parentElement;
  if (parent !== null && parent.tagName !== 'BODY' && inlineOnly(parent) && !skipped(parent)) {
    return false;
  }
  const text = sourceText(element);
  if (text === '' || Array.from(text).length > PAGE_LIMITS.itemChars || !wordy(element, text)) {
    return false;
  }
  return LINK_OK_TAGS.has(element.tagName) || !linkOnly(element, text);
}

/** 一棵子树里能整段译的块（包括它自己）。 */
function candidatesIn(root         )            {
  const found            = [];
  const visit = (element         )       => {
    if (element.matches(SKIP_SELECTOR)) {
      return;
    }
    if (isCandidate(element)) {
      found.push(element);
      return;
    }
    for (const child of Array.from(element.children)) {
      visit(child);
    }
  };
  visit(root);
  return found;
}

function langOf(element         )         {
  return element.closest('[lang]')?.getAttribute('lang') ?? '';
}

// 沉浸式翻译插进网页的样子（Mac 0.4.0，第 2 批）：译文和灰条的样式、悬停小工具条、没译成的段落段尾的小重试标记
// （后两样在影子 DOM 里，页面的样式碰不到）。
// 译文左边 1px 细线（全站「Plasticine 写的」那条线），字色跟页面正文走、略淡，标题的译文跟着放大；减少动态效果时灰条不动。
// 自足：不引别的值（只能 import type）。

// 悬停工具条：移出译文后再等一会儿才收，让鼠标来得及移到工具条上。
const TOOLBAR_HIDE_MS = 220;

const STYLE = `
plasticine-tr{display:block!important;margin:.45em 0 0!important;padding:0 0 0 12px!important;
border-left:1px solid color-mix(in srgb,currentColor 32%,transparent)!important;color:inherit;opacity:.8;
font-size:.9em;line-height:1.7;font-weight:inherit;font-style:normal;text-align:start;white-space:normal;
text-indent:0;letter-spacing:normal;text-transform:none}
plasticine-tr[data-target^="zh"],plasticine-tr[data-target="ja"]{font-family:-apple-system,BlinkMacSystemFont,
"PingFang SC","Hiragino Sans GB","Hiragino Sans","Microsoft YaHei",sans-serif}
plasticine-tr[data-heading]{font-size:.72em;line-height:1.4;opacity:.88;margin-top:.3em!important}
plasticine-tr[data-state="pending"]{opacity:1}
plasticine-bar{display:block;height:.6em;margin:.55em 0;border-radius:4px;
background:color-mix(in srgb,currentColor 11%,transparent)}
plasticine-bar:nth-child(2){width:88%}plasticine-bar:nth-child(3){width:56%}
@media (prefers-reduced-motion:no-preference){plasticine-bar{animation:plasticine-wait 1.4s ease-in-out infinite
alternate}}
@keyframes plasticine-wait{from{opacity:.45}to{opacity:1}}
[data-plasticine-only]{font-size:0!important;margin-top:var(--plasticine-mt)!important;
margin-bottom:var(--plasticine-mb)!important}
[data-plasticine-only]>:not(plasticine-tr){display:none!important}
[data-plasticine-only]>plasticine-tr{display:inline!important;font-size:var(--plasticine-fs)!important;
line-height:var(--plasticine-lh)!important;margin:0!important;padding:0!important;border:0!important;opacity:1!important}
[data-plasticine-only]::marker{font-size:var(--plasticine-fs)}
[data-plasticine-wait]{opacity:.45}
[data-plasticine-wait]>plasticine-tr{display:none!important}
@media (prefers-reduced-motion:no-preference){[data-plasticine-only],[data-plasticine-wait]{transition:opacity .2s ease-out}}
plasticine-tr[data-state="failed"]{display:inline!important;margin:0!important;padding:0!important;
border:0!important;opacity:1}
`;

const TOOLBAR_STYLE = `
:host{all:initial;position:absolute;z-index:2147483647;display:none}
:host([data-open]){display:block}
.bar{display:flex;align-items:center;gap:2px;padding:3px;border-radius:8px;background:#fff;color:#2d2d2b;
box-shadow:0 0 0 1px rgba(45,45,43,.1),0 4px 16px rgba(45,45,43,.12);
font:500 12px/16px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
@media (prefers-color-scheme:dark){.bar{background:#2d2d2b;color:#f9f9f7;
box-shadow:0 0 0 1px rgba(249,249,247,.14),0 4px 16px rgba(0,0,0,.4)}}
.mark{display:grid;place-items:center;width:24px;height:24px;opacity:.5}
button{all:unset;display:flex;align-items:center;gap:4px;height:24px;padding:0 6px;border-radius:6px;cursor:pointer}
button[hidden]{display:none}
button[aria-pressed="true"]{background:rgba(127,127,127,.16)}
button:hover,button:focus-visible{background:rgba(127,127,127,.16)}
svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
`;
// 只看译文时「看原文」浮出来的那张卡：在这段下面，和这段一样宽；页面的样式碰不到（影子 DOM）。
const ORIGINAL_STYLE = `
:host{all:initial;position:absolute;z-index:2147483646;display:none;box-sizing:border-box}
:host([data-open]){display:block}
.card{box-sizing:border-box;padding:10px 14px 12px;border-radius:10px;background:#fff;color:#444;
box-shadow:0 0 0 1px rgba(45,45,43,.1),0 8px 24px rgba(45,45,43,.14);font:15px/24px Georgia,"Times New Roman",serif;
white-space:pre-wrap;overflow-wrap:anywhere}
.label{display:block;margin-bottom:4px;color:#777;font:600 11px/16px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
@media (prefers-color-scheme:dark){.card{background:#2d2d2b;color:#deded9;
box-shadow:0 0 0 1px rgba(249,249,247,.14),0 8px 24px rgba(0,0,0,.4)}.label{color:#a5a59f}}
`;
// 和 client/src/shell/icons.tsx 同一套描边图标（sparkle / refresh / copy / thread）。
const ICONS = {
  sparkle: '<path d="m8 1.5 1.7 4.8L14.5 8l-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7z"/>',
  refresh: '<path d="M13.5 6A5.5 5.5 0 0 0 3 4.5L2.5 7M2.5 3v4h4M2.5 10a5.5 5.5 0 0 0 10.5 1.5l.5-2.5M9.5 9h4v4"/>',
  copy: '<rect x="6" y="6" width="7.5" height="7.5" rx="1.5"/><path d="M10 3H4a1 1 0 0 0-1 1v6"/>',
  thread: '<path d="M3 3.5h10v6.5H7.5L4.5 12.5V10H3z"/>',
};

function svg(path        )         {
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${path}</svg>`;
}

// 重试标记：跟着段落的字号和字色，平时淡，悬停 / 键盘聚焦时清楚。
const RETRY_STYLE = `
:host{all:initial;display:inline-grid;place-items:center;width:1.3em;height:1.3em;margin-left:.3em;
vertical-align:-.2em;border-radius:4px;color:inherit;font-size:inherit;opacity:.55;cursor:pointer}
:host(:hover),:host(:focus-visible){opacity:1;background:color-mix(in srgb,currentColor 12%,transparent);outline:none}
svg{width:.9em;height:.9em;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
`;
const RETRY_LABEL = '没译成，点一下重试';

/** 没译成的段落段尾的小重试标记（↻）：点了、或聚焦时按回车 / 空格，调 onRetry；不让页面自己的点击处理接到。 */
function createRetryMark(doc          , onRetry            )              {
  const mark = doc.createElement('plasticine-retry');
  mark.setAttribute('role', 'button');
  mark.setAttribute('tabindex', '0');
  mark.setAttribute('aria-label', RETRY_LABEL);
  mark.setAttribute('title', RETRY_LABEL);
  const shadow = mark.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${RETRY_STYLE}</style>${svg(ICONS.refresh)}`;
  mark.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRetry();
  });
  mark.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onRetry();
    }
  });
  return mark;
}

                                                             
                                  

function createToolbar(doc          , schedule                                                  )          {
  let element                     = null;
  let toggle                     = null;
  let card                     = null;
  let cardText                     = null;
  let current                        = null;
  let shown                                                        = null;
  let cancelHide                      = null;
  const closeCard = ()       => {
    card?.removeAttribute('data-open');
    toggle?.setAttribute('aria-pressed', 'false');
  };
  const hide = ()       => {
    cancelHide?.();
    cancelHide = null;
    current = null;
    shown = null;
    element?.removeAttribute('data-open');
    closeCard();
  };
  const openCard = ()       => {
    if (shown === null || shown.original === null) {
      return;
    }
    if (card === null || !card.isConnected) {
      card = doc.createElement('plasticine-original');
      const shadow = card.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `<style>${ORIGINAL_STYLE}</style><div class="card" role="note" aria-label="原文">`
        + '<span class="label">原文</span><span class="text"></span></div>';
      cardText = shadow.querySelector('.text');
      card.addEventListener('mouseenter', () => cancelHide?.());
      card.addEventListener('mouseleave', () => hideSoon());
      doc.documentElement.appendChild(card);
    }
    if (cardText !== null) {
      cardText.textContent = shown.original;
    }
    // 译文在只看译文时是行内的：按它所在的那一段（父元素）定宽和位置。
    const block = shown.node.parentElement ?? shown.node;
    const rect = block.getBoundingClientRect();
    const view = doc.defaultView;
    card.style.top = `${Math.round(rect.bottom + 8 + (view?.scrollY ?? 0))}px`;
    card.style.left = `${Math.round(rect.left + (view?.scrollX ?? 0))}px`;
    card.style.width = `${Math.round(Math.max(rect.width, 240))}px`;
    card.setAttribute('data-open', '');
    toggle?.setAttribute('aria-pressed', 'true');
  };
  const hideSoon = ()       => {
    cancelHide?.();
    cancelHide = schedule(hide, TOOLBAR_HIDE_MS);
  };
  const ensure = ()              => {
    if (element !== null && element.isConnected) {
      return element;
    }
    element = doc.createElement('plasticine-toolbar');
    const shadow = element.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>${TOOLBAR_STYLE}</style><div class="bar" role="toolbar" aria-label="译文">`
      + `<span class="mark" role="img" aria-label="Plasticine 译的" title="Plasticine 译的">${svg(ICONS.sparkle)}</span>`
      + '<button data-act="original" aria-pressed="false" title="看原文" hidden><span>看原文</span></button>'
      + `<button data-act="again" aria-label="重译" title="重译">${svg(ICONS.refresh)}</button>`
      + `<button data-act="copy" aria-label="复制译文" title="复制译文">${svg(ICONS.copy)}</button>`
      + `<button data-act="ask" title="问这一段">${svg(ICONS.thread)}<span>问这一段</span></button></div>`;
    shadow.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      const act = target?.getAttribute('data-act');
      event.preventDefault();
      event.stopPropagation();
      if (act === 'original') {
        // 看原文不收工具条：再点一下收起那张卡。
        if (card?.hasAttribute('data-open') === true) {
          closeCard();
        } else {
          openCard();
        }
        return;
      }
      const actions = current;
      hide();
      if (actions === null) {
        return;
      }
      if (act === 'again') {
        actions.again();
      } else if (act === 'copy') {
        actions.copy();
      } else if (act === 'ask') {
        actions.ask();
      }
    });
    toggle = shadow.querySelector('[data-act="original"]');
    element.addEventListener('mouseenter', () => cancelHide?.());
    element.addEventListener('mouseleave', () => hideSoon());
    doc.documentElement.appendChild(element);
    return element;
  };
  const show = (node             , actions                , original         )       => {
    cancelHide?.();
    current = actions;
    // 换到另一段：上一段的原文卡收起。
    if (shown !== null && shown.node !== node) {
      closeCard();
    }
    shown = { node, original: original ?? null };
    const bar = ensure();
    toggle?.toggleAttribute('hidden', original === undefined);
    bar.setAttribute('data-open', '');
    const rect = node.getBoundingClientRect();
    const view = doc.defaultView;
    const height = bar.offsetHeight || 30;
    const width = bar.offsetWidth || 180;
    const above = rect.top - height - 6;
    const top = above >= 4 ? above : rect.bottom + 6;
    bar.style.top = `${Math.round(top + (view?.scrollY ?? 0))}px`;
    bar.style.left = `${Math.round(Math.max(4, rect.right - width) + (view?.scrollX ?? 0))}px`;
  };
  const remove = ()       => {
    hide();
    element?.remove();
    element = null;
    toggle = null;
    card?.remove();
    card = null;
    cardText = null;
  };
  return { show, hide, hideSoon, remove };
}

// 沉浸式翻译注入网页标签的脚本（Mac 0.4.0，第 2 批）。Mac 原生层把它作为 WKUserScript 注入每个网页标签的独立脚本世界
// （页面自己的脚本碰不到这里的函数），scripts/generate-translate-script.ts 把这一份和
// translate-page-rules.ts（切段规则）、translate-page-look.ts（样子、工具条和重试标记）、translate-page-host.ts
// （浏览器里的外部能力）去掉类型拼起来，生成 Mac 和 iPhone 的 translate-page-script.swift。四份之间的 import 拼的时候
// 抹掉，所以只引这四份和 import type。
//
// 做什么：切段（正文段落、标题、列表项、表格格、引用、图注……；跳过导航、页头页脚、按钮、输入框、代码、可编辑区、隐藏的、
// 已经是目标语言的）→ 视口里的先送、往下一屏的后送（IntersectionObserver）→ 新冒出来的内容接着切（MutationObserver，
// X 这种一直加载的页面）→ 没回来的先放两三条灰条 → 回来换成译文（双语对照：原文下面一段，左边 1px 细线、字色跟页面走、
// 略淡，标题的译文跟着大；只看译文：原文藏起，悬停看原文）→ 关掉全部还原。悬停译文出小工具条：重译、复制、问这一段。
// 没译成的段落原文不动，段尾留一个小重试标记；同一轮再配置一次（网页界面的「重试」）把没译成的全部重新排队。
// 关掉时按（目标语言、原文）记住已有的译文，再开先直接插回，缺的才再要（2026-11-04 修「开 → 关 → 再开不翻了」）：
// 记在脚本里，不经原生层和网页界面、不占并发，零往返；换了文档脚本重装、记的跟着没，那时服务端缓存兜底。
// 设备不调模型：段落经原生层交给网页界面，网页界面调 /v2/translate，译文再经原生层送回 apply()。只读页面上的字，
// 不读输入框里填的内容；页面上有卡号框（付款）就不开翻。

/** 脚本发给原生层的消息：报给网页界面的四种，加一个原生自己处理的「复制」。 */

// 等新内容停一停再切（X 往下滚一次会冒出好几批节点）；送段落也攒一下，免得一段一个请求。
const MUTATION_SETTLE_MS = 250;
const FLUSH_MS = 30;
// 一份文档最多记这么多段译文：一篇长文几百段，一直加载的时间线滚一晚上也就上千段；超了先忘最早的。
const REMEMBER_MAX = 2_000;

/** 脚本用到的外部能力：浏览器里用 browserHost（translate-page-host.ts），测试换成假的（jsdom 没有布局）。 */

                                                           

                       

                                

                    

function installPageTranslator(host                )                 {
  const doc = host.document;
  const nonce = Math.random().toString(36).slice(2, 8);
  let counter = 0;
  let config                             = null;
  let startedAt = 0;
  let firstScreenMs                = null;
  let chars = 0;
  const segments = new Map                 ();
  const byElement = new Map                  ();
  const queue                                       = { visible: [], ahead: [] };
  /** 记住的译文：键是目标语言 + 原文，关掉不清，再开先从这里插回。 */
  const remembered = new Map                ();
  let cancelFlush                      = null;
  let cancelSettle                      = null;
  let watcher                         = null;
  let mutations                          = null;
  let style                          = null;
  const toolbar = createToolbar(doc, host.schedule);

  host.post({ type: 'page', url: doc.location.href, blocked: doc.querySelector(CARD_FIELDS) !== null });

  function onOver(event       )       {
    const target = event.target instanceof Element ? event.target.closest('plasticine-tr') : null;
    const segment = target === null ? undefined : segments.get(target.getAttribute('data-plasticine-tr') ?? '');
    if (segment !== undefined && segment.state === 'done' && segment.node !== null) {
      const chosen = segment;
      toolbar.show(segment.node, { again: () => retranslate(chosen), copy: () => copy(chosen),
        ask: () => ask(chosen) }, config?.display === 'translation' ? chosen.source : undefined);
    }
  }

  function onOut(event       )       {
    const target = event.target instanceof Element ? event.target.closest('plasticine-tr') : null;
    if (target !== null) {
      toolbar.hideSoon();
    }
  }

  function progress()       {
    if (config === null) {
      return;
    }
    const all = [...segments.values()];
    const first = all.filter((segment) => segment.firstScreen);
    if (firstScreenMs === null && first.length > 0
      && first.every((segment) => segment.state === 'done' || segment.state === 'failed')) {
      firstScreenMs = Math.max(0, Math.round(host.now() - startedAt));
      host.post({ type: 'progress', run: config.run, ...counts(all), chars, firstScreenMs });
      return;
    }
    host.post({ type: 'progress', run: config.run, ...counts(all), chars, firstScreenMs: null });
  }

  /** 排着还没发出去的也算在等：开翻时第一批发出前不报 0（不然网页界面会先当成都译完了）。 */
  function counts(all           ) {
    return {
      pending: all.filter((segment) => segment.state === 'pending').length + queue.visible.length
        + queue.ahead.length,
      done: all.filter((segment) => segment.state === 'done').length,
      failed: all.filter((segment) => segment.state === 'failed').length,
    };
  }

  function register(element         )                 {
    if (byElement.has(element) || config === null) {
      return null;
    }
    const source = sourceText(element);
    if (alreadyTarget(source, config.target, langOf(element))) {
      return null;
    }
    counter += 1;
    const segment          = { id: `${nonce}-${counter}`, element, source, heading: HEADING_TAGS.has(element.tagName),
      state: 'idle', node: null, translation: null, firstScreen: false, styleBefore: null };
    segments.set(segment.id, segment);
    byElement.set(element, segment);
    return segment;
  }

  function memoryKey(source        )         {
    return `${config?.target ?? ''}\u0000${source}`;
  }

  function remember(segment         , text        )       {
    const key = memoryKey(segment.source);
    remembered.delete(key);
    remembered.set(key, text);
    if (remembered.size > REMEMBER_MAX) {
      const oldest = remembered.keys().next();
      if (oldest.done !== true) {
        remembered.delete(oldest.value);
      }
    }
  }

  /** 该译这一段了：记得译文就直接插回，不记得才排队送出去。 */
  function enqueue(segment         , where                   )       {
    if (segment.state !== 'idle' || queue.visible.includes(segment) || queue.ahead.includes(segment)) {
      return;
    }
    watcher?.unwatch(segment.element);
    const known = remembered.get(memoryKey(segment.source));
    if (known !== undefined) {
      render(segment, known);
    } else {
      queue[where].push(segment);
    }
    // 插回的也攒一下再报进度（flush 队列空时只报进度）。
    if (cancelFlush === null) {
      cancelFlush = host.schedule(flush, FLUSH_MS);
    }
  }

  function placeholder(segment         )              {
    const node = segment.node ?? doc.createElement('plasticine-tr');
    node.setAttribute('data-plasticine-tr', segment.id);
    node.setAttribute('data-target', config?.target ?? '');
    node.setAttribute('data-state', 'pending');
    node.setAttribute('aria-busy', 'true');
    node.removeAttribute('title');
    if (segment.heading) {
      node.setAttribute('data-heading', '');
    }
    const bars = segment.heading ? 1 : segment.source.length < 160 ? 2 : 3;
    node.replaceChildren(...Array.from({ length: bars }, () => doc.createElement('plasticine-bar')));
    if (!node.isConnected) {
      segment.element.appendChild(node);
    }
    segment.node = node;
    waitMode(segment, config?.display === 'translation');
    return node;
  }

  function send(batch           , where                   , fresh         )       {
    if (config === null || batch.length === 0) {
      return;
    }
    for (const segment of batch) {
      segment.state = 'pending';
      placeholder(segment);
      chars += Array.from(segment.source).length;
    }
    host.post({ type: 'request', run: config.run, url: doc.location.href, priority: where, fresh,
      items: batch.map((segment) => ({ id: segment.id, text: segment.source })) });
  }

  function flush()       {
    cancelFlush = null;
    for (const where of ['visible', 'ahead']         ) {
      let batch            = [];
      let size = 0;
      for (const segment of queue[where].splice(0)) {
        const length = Array.from(segment.source).length;
        if (batch.length >= PAGE_LIMITS.batchItems || size + length > PAGE_LIMITS.batchChars) {
          send(batch, where, false);
          batch = [];
          size = 0;
        }
        batch.push(segment);
        size += length;
      }
      send(batch, where, false);
    }
    progress();
  }

  /** 只看译文时还没译到的段落：原文先留着、变淡（不出灰条），译好了原地换。 */
  function waitMode(segment         , on         )       {
    (segment.element               ).toggleAttribute('data-plasticine-wait', on && segment.state !== 'done');
  }

  /**
   * 只看译文：原文的字号记成变量（译文照这个大小），元素标 data-plasticine-only（样式把原文藏起）。
   * 还原时连 style 属性一起还原：原来没有就去掉，不留一个空的 style=""。
   */
  function onlyMode(segment         , on         )       {
    const element = segment.element               ;
    // 等着的样子只给「只看译文、正在等」的段落；译好了、没译成、换回双语对照都撤掉。
    element.toggleAttribute('data-plasticine-wait', on && segment.node?.getAttribute('data-state') === 'pending');
    if (on && segment.state === 'done') {
      if (!element.hasAttribute('data-plasticine-only')) {
        const computed = doc.defaultView?.getComputedStyle(element);
        segment.styleBefore = element.getAttribute('style');
        // 字号清零后按 em 算的外边距也跟着没了：原来的字号、行高、上下外边距都记成像素。
        element.style.setProperty('--plasticine-fs', computed?.fontSize || '16px');
        element.style.setProperty('--plasticine-lh', computed?.lineHeight || 'normal');
        element.style.setProperty('--plasticine-mt', computed?.marginTop || '0px');
        element.style.setProperty('--plasticine-mb', computed?.marginBottom || '0px');
      }
      element.setAttribute('data-plasticine-only', '');
      return;
    }
    if (!element.hasAttribute('data-plasticine-only')) {
      return;
    }
    element.removeAttribute('data-plasticine-only');
    for (const name of ['--plasticine-fs', '--plasticine-lh', '--plasticine-mt', '--plasticine-mb']) {
      element.style.removeProperty(name);
    }
    if (segment.styleBefore === null && element.getAttribute('style') === '') {
      element.removeAttribute('style');
    }
  }

  function render(segment         , text        )       {
    const node = segment.node ?? placeholder(segment);
    node.removeAttribute('aria-busy');
    node.setAttribute('data-state', 'done');
    node.setAttribute('lang', config?.target ?? '');
    node.replaceChildren(doc.createTextNode(text));
    segment.translation = text;
    segment.state = 'done';
    remember(segment, text);
    onlyMode(segment, config?.display === 'translation');
  }

  /** 没译成：灰条撤掉、原文不动，段尾留一个小重试标记，点了只重要这一段。 */
  function fail(segment         )       {
    onlyMode(segment, false);
    const node = segment.node ?? doc.createElement('plasticine-tr');
    node.setAttribute('data-plasticine-tr', segment.id);
    node.setAttribute('data-state', 'failed');
    node.removeAttribute('aria-busy');
    node.replaceChildren(createRetryMark(doc, () => retryOne(segment)));
    if (!node.isConnected) {
      segment.element.appendChild(node);
    }
    segment.node = node;
    segment.translation = null;
    segment.state = 'failed';
  }

  function retryOne(segment         )       {
    if (config === null || segment.state !== 'failed') {
      return;
    }
    segment.state = 'idle';
    send([segment], 'visible', false);
    progress();
  }

  /** 同一轮再配置一次：没译成的全部重新排队（记得译文的直接插回）。 */
  function retryFailed()       {
    for (const segment of segments.values()) {
      if (segment.state === 'failed') {
        segment.state = 'idle';
        enqueue(segment, 'visible');
      }
    }
  }

  function reset(segment         )       {
    onlyMode(segment, false);
    segment.node?.remove();
    segment.node = null;
    segment.translation = null;
    segment.state = 'idle';
  }

  function retranslate(segment         )       {
    onlyMode(segment, false);
    segment.state = 'idle';
    send([segment], 'visible', true);
    progress();
  }

  function copy(segment         )       {
    if (segment.translation !== null) {
      host.post({ type: 'copy', text: segment.translation });
    }
  }

  function ask(segment         )       {
    host.post({ type: 'ask', url: doc.location.href, title: doc.title,
      source: clip(segment.source, PAGE_LIMITS.askChars), translation: clip(segment.translation ?? '',
        PAGE_LIMITS.askChars) });
  }

  function scan(root         )       {
    for (const element of candidatesIn(root)) {
      const segment = register(element);
      if (segment !== null) {
        watcher?.watch(element);
      }
    }
  }

  function ours(node      )          {
    const element = node.nodeType === 1 ? node            : node.parentElement;
    return element !== null && element.closest('plasticine-tr, plasticine-toolbar') !== null;
  }

  function segmentAround(node      )                      {
    for (let element = node.nodeType === 1 ? node            : node.parentElement; element !== null;
      element = element.parentElement) {
      const segment = byElement.get(element);
      if (segment !== undefined) {
        return segment;
      }
    }
    return undefined;
  }

  /** 新冒出来的节点从哪儿重新切：块元素从它自己切；字和行内元素从装它的那个块切。 */
  function rootFor(node      , container      )                 {
    let element = node.nodeType === 1 && !INLINE_TAGS.has((node           ).tagName) ? node
      : container.nodeType === 1 ? container            : container.parentElement;
    while (element !== null && INLINE_TAGS.has(element.tagName)) {
      element = element.parentElement;
    }
    return element;
  }

  function settle(records                  )       {
    const roots = new Set         ();
    const touched = new Set         ();
    for (const record of records) {
      if (ours(record.target)) {
        continue;
      }
      const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
      if (record.type === 'childList' && nodes.length > 0 && nodes.every(ours)) {
        continue;
      }
      const segment = segmentAround(record.target);
      if (segment !== undefined) {
        touched.add(segment);
        continue;
      }
      for (const node of Array.from(record.addedNodes)) {
        const root = ours(node) ? null : rootFor(node, record.target);
        if (root !== null) {
          roots.add(root);
        }
      }
    }
    for (const segment of [...segments.values()]) {
      if (!segment.element.isConnected) {
        segments.delete(segment.id);
        byElement.delete(segment.element);
      }
    }
    for (const segment of touched) {
      const text = sourceText(segment.element);
      if (text !== segment.source && segment.element.isConnected) {
        reset(segment);
        segment.source = text;
        watcher?.watch(segment.element);
      }
    }
    for (const root of roots) {
      if (root.isConnected && segmentAround(root) === undefined) {
        scan(root);
      }
    }
    progress();
  }

  function start(next                     )          {
    if (doc.querySelector(CARD_FIELDS) !== null) {
      host.post({ type: 'page', url: doc.location.href, blocked: true });
      return false;
    }
    if (config !== null && config.run === next.run && config.target === next.target) {
      config = next;
      for (const segment of segments.values()) {
        onlyMode(segment, next.display === 'translation');
      }
      retryFailed();
      progress();
      return true;
    }
    if (config !== null) {
      stop();
    }
    config = next;
    startedAt = host.now();
    firstScreenMs = null;
    chars = 0;
    style = doc.createElement('style');
    style.setAttribute('data-plasticine-translate', '');
    style.textContent = STYLE;
    (doc.head ?? doc.documentElement).appendChild(style);
    watcher = host.watcher((element, where) => {
      const segment = byElement.get(element);
      if (segment !== undefined) {
        enqueue(segment, where);
      }
    });
    const body = doc.body;
    if (body !== null) {
      for (const element of candidatesIn(body)) {
        const segment = register(element);
        if (segment === null) {
          continue;
        }
        const where = host.where(element);
        segment.firstScreen = where === 'visible';
        if (where === null) {
          watcher.watch(element);
        } else {
          enqueue(segment, where);
        }
      }
      const view = doc.defaultView;
      if (view !== null && typeof view.MutationObserver === 'function') {
        mutations = new view.MutationObserver((records) => {
          cancelSettle?.();
          const pending = [...records];
          cancelSettle = host.schedule(() => { cancelSettle = null; settle(pending); }, MUTATION_SETTLE_MS);
        });
        mutations.observe(body, { childList: true, subtree: true, characterData: true });
      }
    }
    doc.addEventListener('mouseover', onOver, true);
    doc.addEventListener('mouseout', onOut, true);
    progress();
    return true;
  }

  function stop()       {
    cancelFlush?.();
    cancelFlush = null;
    cancelSettle?.();
    cancelSettle = null;
    mutations?.disconnect();
    mutations = null;
    watcher?.disconnect();
    watcher = null;
    for (const segment of segments.values()) {
      reset(segment);
    }
    segments.clear();
    byElement.clear();
    queue.visible = [];
    queue.ahead = [];
    style?.remove();
    style = null;
    toolbar.remove();
    doc.removeEventListener('mouseover', onOver, true);
    doc.removeEventListener('mouseout', onOut, true);
    config = null;
  }

  function apply(delivery                   )       {
    if (config === null || delivery.run !== config.run) {
      return;
    }
    for (const item of delivery.items) {
      const segment = segments.get(item.id);
      if (segment !== undefined && segment.state === 'pending' && item.text.trim() !== '') {
        render(segment, item.text);
      }
    }
    for (const id of delivery.failed) {
      const segment = segments.get(id);
      if (segment !== undefined && segment.state === 'pending') {
        fail(segment);
      }
    }
    progress();
  }

  return { start, stop, apply, running: () => config?.run ?? null };
}

// 沉浸式翻译注入脚本在浏览器里的外部能力（从 translate-page.ts 拆出来：那份只管切段、排队、插译文）。
// IntersectionObserver 看视口和往下一屏，setTimeout 攒批，消息交给原生层给的 post。和另外三份一起由
// scripts/generate-translate-script.ts 拼进注入脚本，所以只能 import type。

/** 浏览器里的实现：IntersectionObserver 看视口和往下一屏，setTimeout 攒批。 */
function browserHost(post                                       )                 {
  const where = (element         )                           => {
    if (element.getClientRects().length === 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const height = window.innerHeight;
    if (rect.bottom > 0 && rect.top < height) {
      return 'visible';
    }
    return rect.top >= height && rect.top < height * 2 ? 'ahead' : null;
  };
  return {
    document,
    post,
    now: () => performance.now(),
    schedule(callback, ms) {
      const handle = setTimeout(callback, ms);
      return () => clearTimeout(handle);
    },
    where,
    watcher(onEnter) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const rect = entry.boundingClientRect;
            onEnter(entry.target, rect.top < window.innerHeight && rect.bottom > 0 ? 'visible' : 'ahead');
          }
        }
      }, { rootMargin: '0px 0px 100% 0px' });
      return {
        watch: (element) => observer.observe(element),
        unwatch: (element) => observer.unobserve(element),
        disconnect: () => observer.disconnect(),
      };
    },
  };
}
window.__plasticineExtract = (command) => extractPage(document, command);
window.__plasticineTranslator = installPageTranslator(browserHost((message) => {
  window.webkit.messageHandlers.plasticineTranslatePage.postMessage(message);
}));
})();
"""#
}
