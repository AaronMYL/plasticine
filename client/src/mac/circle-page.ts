// 圈一块注入网页标签的脚本（2026-11-04 第 2 批「浏览器」，设计稿 Web-Ask）：网页界面点了「圈一块」，原生层用
// callAsyncJavaScript 在网页标签的独立脚本世界（.defaultClient，页面自己的脚本碰不到）里跑这一段：盖一层透明的面，
// 鼠标停在哪个元素上就描出它的边；按下拖一个框就是框住的那一块，不拖直接点就是点的那个元素。松手回
// { text, url, title }（JSON 字符串），按 Esc 或原生调 window.__plasticineCircleCancel() 回 null。
// 只读页面上看得见的字（文本节点、图片的 alt），从不读输入框里填的内容。描边用 Plasticine 的前景色 1.5px，和设计稿一样。
//
// 这一段 JS 只写一份（下面的字符串），Mac 的 mac/Sources/Plasticine/circle-page-script.swift 和 iPhone 的
// ios/Core/Sources/PlasticineCore/circle-page-script.swift 原样带一份；tests/mac/circle-page.test.ts 核对三份一样，
// 并在 jsdom 里跑它。字符串里不用反引号和 ${。

/** 和 agent/shared/api/web-page-tools.ts 的 WEB_CIRCLE_TEXT_MAX_CHARS 一致（这里不能引值，测试核对）。 */
export const CIRCLE_TEXT_MAX_CHARS = 20_000;

export const CIRCLE_PAGE_SCRIPT = String.raw`if (typeof window.__plasticineCircleCancel === 'function') {
  window.__plasticineCircleCancel();
}
return await new Promise((resolve) => {
  const MAX_CHARS = 20000;
  const DRAG = 6;
  const INK = '#2D2D2B';
  const doc = document;
  const layer = doc.createElement('plasticine-circle');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;cursor:crosshair;'
    + 'background:transparent;';
  const box = doc.createElement('div');
  box.style.cssText = 'position:fixed;display:none;border-radius:4px;pointer-events:none;'
    + 'box-shadow:0 0 0 1.5px ' + INK + ';background:rgba(45,45,43,0.05);';
  layer.appendChild(box);
  (doc.body || doc.documentElement).appendChild(layer);
  let start = null;

  const show = (left, top, width, height) => {
    box.style.display = 'block';
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = Math.max(0, width) + 'px';
    box.style.height = Math.max(0, height) + 'px';
  };
  const under = (x, y) => {
    layer.style.pointerEvents = 'none';
    const element = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
    layer.style.pointerEvents = 'auto';
    return element && !layer.contains(element) ? element : null;
  };
  const clip = (text) => Array.from(text).slice(0, MAX_CHARS).join('');
  const visible = (element) => {
    if (!element || element.closest('plasticine-circle')) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textOf = (element) => {
    if (!element) return '';
    if (element.tagName === 'IMG') return element.getAttribute('alt') || '';
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
      return element.getAttribute('aria-label') || element.getAttribute('placeholder') || '';
    }
    return (element.innerText || element.textContent || '').trim();
  };
  const blockOf = (node) => {
    let element = node.parentElement;
    while (element && element !== doc.body) {
      const display = getComputedStyle(element).display;
      if (display !== 'inline' && display !== 'contents') return element;
      element = element.parentElement;
    }
    return element;
  };
  const meets = (rect, area) => rect.width > 0 && rect.height > 0 && rect.right > area.left
    && rect.left < area.right && rect.bottom > area.top && rect.top < area.bottom;
  const textIn = (area) => {
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
    const parts = [];
    let lastBlock = null;
    let length = 0;
    for (let node = walker.nextNode(); node !== null && length < MAX_CHARS; node = walker.nextNode()) {
      const value = node.nodeValue || '';
      if (value.trim() === '' || !visible(node.parentElement)) continue;
      const tag = node.parentElement.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const hit = Array.from(range.getClientRects()).some((rect) => meets(rect, area));
      if (!hit) continue;
      const block = blockOf(node);
      if (parts.length > 0 && block !== lastBlock) parts.push('\n');
      lastBlock = block;
      parts.push(value.replace(/\s+/g, ' '));
      length += value.length;
    }
    for (const image of Array.from(doc.images)) {
      const alt = (image.getAttribute('alt') || '').trim();
      if (alt !== '' && visible(image) && meets(image.getBoundingClientRect(), area)) parts.push('\n〔图：' + alt + '〕');
    }
    return parts.join('').split('\n').map((line) => line.trim()).filter((line) => line !== '').join('\n');
  };
  const finish = (value) => {
    layer.remove();
    window.removeEventListener('keydown', onKey, true);
    delete window.__plasticineCircleCancel;
    resolve(value === null ? null : JSON.stringify({ text: clip(value), url: location.href, title: doc.title }));
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    }
  };
  window.__plasticineCircleCancel = () => finish(null);
  window.addEventListener('keydown', onKey, true);
  layer.addEventListener('pointermove', (event) => {
    if (start !== null) {
      show(Math.min(start.x, event.clientX), Math.min(start.y, event.clientY), Math.abs(event.clientX - start.x),
        Math.abs(event.clientY - start.y));
      return;
    }
    const element = under(event.clientX, event.clientY);
    if (element === null) {
      box.style.display = 'none';
      return;
    }
    const rect = element.getBoundingClientRect();
    show(rect.left - 2, rect.top - 2, rect.width + 4, rect.height + 4);
  });
  layer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
  });
  layer.addEventListener('pointerup', (event) => {
    event.preventDefault();
    const from = start || { x: event.clientX, y: event.clientY };
    start = null;
    const dragged = Math.abs(event.clientX - from.x) > DRAG || Math.abs(event.clientY - from.y) > DRAG;
    if (dragged) {
      finish(textIn({ left: Math.min(from.x, event.clientX), top: Math.min(from.y, event.clientY),
        right: Math.max(from.x, event.clientX), bottom: Math.max(from.y, event.clientY) }));
      return;
    }
    finish(textOf(under(event.clientX, event.clientY)));
  });
});`;
