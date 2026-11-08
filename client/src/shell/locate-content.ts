/** 仅主动跳转时定位；短暂描边仍保留，减少动态效果偏好下不播放动画。 */
export function locateContent(element: HTMLElement | null, scroll = true): void {
  if (element === null) return;
  if (scroll) {
    element.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    if (!element.hasAttribute('tabindex')) element.tabIndex = -1;
    element.focus({ preventScroll: true });
  }
  element.classList.remove('content-located');
  requestAnimationFrame(() => element.classList.add('content-located'));
  setTimeout(() => element.classList.remove('content-located'), 2400);
}
