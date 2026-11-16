// 演示用的小工具：等待、假光标（看得见的鼠标）、找元素、打字。只在 demo 入口里用。

export class Stopped extends Error {}
/** 等的东西一直没出现：这一幕到此为止，接着放下一幕。 */
export class Missed extends Error {}

export interface Stage {
  /** 换了一幕就把上一幕停掉：每次等待之后都查一下。 */
  alive: () => boolean;
}

const PAUSE_POLL_MS = 200;
let paused = false;

/**
 * 官网把演示滚出视野时先停住，滚回来接着放：演示里打字会让浏览器把光标滚进视野，
 * 不停住的话访客在看别处时页面会被拽回来。
 */
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

/** 圆点 18px（demo.css）：位置减掉一半，圆心落在要点的地方；宽的元素点靠左这么远的位置。 */
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

/** 假光标移到这个元素上（不点）。 */
export async function pointAt(stage: Stage, element: Element): Promise<void> {
  const box = element.getBoundingClientRect();
  const dot = cursorElement();
  const x = box.left + Math.min(box.width / 2, CURSOR_REACH) - CURSOR_HALF;
  dot.style.transform = `translate(${x}px, ${box.top + box.height / 2 - CURSOR_HALF}px)`;
  dot.dataset['shown'] = 'true';
  await sleep(stage, 650);
}

/** 假光标移过去、点一下。 */
export async function click(stage: Stage, element: HTMLElement): Promise<void> {
  await pointAt(stage, element);
  const dot = cursorElement();
  dot.dataset['press'] = 'true';
  await sleep(stage, 160);
  delete dot.dataset['press'];
  element.click();
  await sleep(stage, 350);
}

/** 在输入框（textarea 或可编辑区域）的末尾一个字一个字打进去。 */
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
