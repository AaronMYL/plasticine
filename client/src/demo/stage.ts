export class Stopped extends Error {}
export class Missed extends Error {}

export interface Stage {
  alive: () => boolean;
}

const PAUSE_POLL_MS = 200;
let paused = false;

export function setPaused(value: boolean): void {
  paused = value;
}

export const sleep = (stage: Stage, ms: number): Promise<void> => new Promise((resolve, reject) => {
  const wake = (): void => {
    if (!stage.alive()) {
      reject(new Stopped());
    } else if (paused) {
      setTimeout(wake, PAUSE_POLL_MS);
    } else {
      resolve();
    }
  };
  setTimeout(wake, ms);
});

export async function waitFor<T>(stage: Stage, find: () => T | null | undefined, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found !== null && found !== undefined) return found;
    if (Date.now() > deadline) throw new Missed();
    await sleep(stage, 120);
  }
}

const CLICKABLE = 'button, a, label, [role="button"], [role="switch"]';

export function byText(text: string, selector = CLICKABLE): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if ((element.textContent ?? '').trim().startsWith(text) && element.offsetParent !== null) return element;
  }
  return null;
}

const CURSOR_HALF = 9;
const CURSOR_REACH = 120;
let cursor: HTMLElement | null = null;

function cursorElement(): HTMLElement {
  if (cursor === null) {
    cursor = document.createElement('div');
    cursor.className = 'demo-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    document.body.append(cursor);
  }
  return cursor;
}

export async function pointAt(stage: Stage, element: Element): Promise<void> {
  const box = element.getBoundingClientRect();
  const dot = cursorElement();
  const x = box.left + Math.min(box.width / 2, CURSOR_REACH) - CURSOR_HALF;
  dot.style.transform = `translate(${x}px, ${box.top + box.height / 2 - CURSOR_HALF}px)`;
  dot.dataset['shown'] = 'true';
  await sleep(stage, 650);
}

export async function click(stage: Stage, element: HTMLElement): Promise<void> {
  await pointAt(stage, element);
  const dot = cursorElement();
  dot.dataset['press'] = 'true';
  await sleep(stage, 160);
  delete dot.dataset['press'];
  element.click();
  await sleep(stage, 350);
}

export async function typeInto(stage: Stage, editor: HTMLElement, text: string, stepMs = 55): Promise<void> {
  editor.focus({ preventScroll: true });
  if (!(editor instanceof HTMLTextAreaElement)) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  for (const char of text) {
    document.execCommand('insertText', false, char);
    await sleep(stage, stepMs);
  }
}
