// 在真实页面内使用原生 DOM；同一段表达式也交给假浏览器执行，避免两套选择规则。
export type ShotLocator = { selector: string } | { text: string; within?: string };

export function selectorPreflight(selectors: string[]): string {
  return `(() => {
    for (const selector of ${JSON.stringify(selectors)}) {
      try { document.querySelector(selector); }
      catch (error) {
        if (error.name === 'SyntaxError') { return selector; }
        throw error;
      }
    }
    return true;
  })()`;
}

export function locateShotElement(locator: ShotLocator, click = false): string {
  return `(() => {
    const locator = ${JSON.stringify(locator)};
    const click = ${JSON.stringify(click)};
    function visible(element) {
      if (!(element instanceof HTMLElement)) { return false; }
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0
        || rect.top >= innerHeight || rect.left >= innerWidth) { return false; }
      const ownStyle = getComputedStyle(element);
      if (ownStyle.visibility === 'hidden' || ownStyle.visibility === 'collapse') { return false; }
      for (let parent = element; parent !== null; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.opacity === '0') { return false; }
      }
      return true;
    }
    function enabled(element) {
      return !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true';
    }
    const normalize = (text) => text.replace(/\\s+/g, ' ').trim();
    function find() {
      if ('selector' in locator) { return document.querySelector(locator.selector); }
      const roots = locator.within === undefined ? [document.body] : document.querySelectorAll(locator.within);
      for (const root of roots) {
        if (root === null) { continue; }
        for (const element of [root, ...root.querySelectorAll('*')]) {
          if (!visible(element) || normalize(element.innerText) !== normalize(locator.text)) { continue; }
          if (!click) {
            const range = document.createRange();
            range.selectNodeContents(element);
            const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
            if (rects.length > 0 && rects.every((rect) => rect.bottom > 0 && rect.right > 0
              && rect.top < innerHeight && rect.left < innerWidth)) { return element; }
            continue;
          }
          const clickable = element.closest('button, a, [role="button"]');
          if (clickable !== null && root.contains(clickable) && visible(clickable) && enabled(clickable)) {
            return clickable;
          }
        }
      }
      return null;
    }
    const element = find();
    if (!visible(element) || (click && !enabled(element))) { return false; }
    if (click) { element.click(); }
    return true;
  })()`;
}
