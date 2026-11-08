import { Type } from 'typebox';
import { BrowserInspectionSchema } from '../../shared/browser-observation.ts';

export const CdpInspectionSchema = Type.Object({ result: Type.Object({ value: BrowserInspectionSchema }) });

// Read the visible top document and element geometry, never cookies, storage or input values. Scripts are fixed,
// not model-provided JavaScript; page strings remain external material in the tool response.
export const OBSERVE_PAGE = `(() => {
  const __plasticineObservation = true;
  const candidates = [...document.querySelectorAll(
    'a,button,input,textarea,select,summary,[role],[contenteditable="true"],[tabindex]')];
  const visible = candidates.filter(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth
      && style.visibility !== 'hidden' && style.display !== 'none';
  }).slice(0, 40);
  return {
    url: location.href.slice(0, 3000), title: document.title.slice(0, 300), documentId: performance.timeOrigin,
    text: (document.body?.innerText ?? '').slice(0, 6000),
    viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
    elements: visible.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      return {
        id: 'e' + (index + 1), tag, role: (element.getAttribute('role') ?? tag).slice(0, 80),
        text: (element.innerText ?? element.textContent ?? '').trim().slice(0, 100),
        label: (element.getAttribute('aria-label') ?? element.getAttribute('placeholder') ?? '').slice(0, 100),
        disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
        focused: document.activeElement === element,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    })
  };
})()`;
