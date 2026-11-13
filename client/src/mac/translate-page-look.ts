// 沉浸式翻译插进网页的样子（Mac 0.4.0，第 2 批）：译文和灰条的样式、悬停小工具条、没译成的段落段尾的小重试标记
// （后两样在影子 DOM 里，页面的样式碰不到）。
// 译文左边 1px 细线（全站「Plasticine 写的」那条线），字色跟页面正文走、略淡，标题的译文跟着放大；减少动态效果时灰条不动。
// 自足：不引别的值（只能 import type）。

// 悬停工具条：移出译文后再等一会儿才收，让鼠标来得及移到工具条上。
const TOOLBAR_HIDE_MS = 220;

export const STYLE = `
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

export const TOOLBAR_STYLE = `
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

function svg(path: string): string {
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${path}</svg>`;
}

// 重试标记：跟着段落的字号和字色，平时淡，悬停 / 键盘聚焦时清楚。
const RETRY_STYLE = `
:host{all:initial;display:inline-grid;place-items:center;width:1.3em;height:1.3em;margin-left:.3em;
vertical-align:-.2em;border-radius:4px;color:inherit;font-size:inherit;opacity:.55;cursor:pointer}
:host(:hover),:host(:focus-visible){opacity:1;background:color-mix(in srgb,currentColor 12%,transparent);outline:none}
svg{width:.9em;height:.9em;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
`;
export const RETRY_LABEL = '没译成，点一下重试';

/** 没译成的段落段尾的小重试标记（↻）：点了、或聚焦时按回车 / 空格，调 onRetry；不让页面自己的点击处理接到。 */
export function createRetryMark(doc: Document, onRetry: () => void): HTMLElement {
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

export interface ToolbarActions {
  again(): void;
  copy(): void;
  ask(): void;
}

export interface Toolbar {
  /**
   * 在这段译文的右上角出工具条；按钮点了调 actions。original 给了（只看译文时）就多一个「看原文」：
   * 点了在这段下面浮出原文，再点收起；鼠标移开和工具条一起收。
   */
  show(node: HTMLElement, actions: ToolbarActions, original?: string): void;
  hide(): void;
  hideSoon(): void;
  remove(): void;
}

export function createToolbar(doc: Document, schedule: (callback: () => void, ms: number) => () => void): Toolbar {
  let element: HTMLElement | null = null;
  let toggle: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let cardText: HTMLElement | null = null;
  let current: ToolbarActions | null = null;
  let shown: { node: HTMLElement; original: string | null } | null = null;
  let cancelHide: (() => void) | null = null;
  const closeCard = (): void => {
    card?.removeAttribute('data-open');
    toggle?.setAttribute('aria-pressed', 'false');
  };
  const hide = (): void => {
    cancelHide?.();
    cancelHide = null;
    current = null;
    shown = null;
    element?.removeAttribute('data-open');
    closeCard();
  };
  const openCard = (): void => {
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
  const hideSoon = (): void => {
    cancelHide?.();
    cancelHide = schedule(hide, TOOLBAR_HIDE_MS);
  };
  const ensure = (): HTMLElement => {
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
  const show = (node: HTMLElement, actions: ToolbarActions, original?: string): void => {
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
  const remove = (): void => {
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
