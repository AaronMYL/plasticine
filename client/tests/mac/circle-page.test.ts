// 圈一块注入网页标签的脚本（第 2 批「浏览器」）：在 jsdom 里跑它——点一个元素回它的字，拖一个框回框住的字（按块换行，
// 图片带 alt），不读输入框里填的内容；Esc、原生取消回 null，盖的那一层收走。Mac 和 iPhone 的 Swift 各带一份，一字不差。

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEB_CIRCLE_TEXT_MAX_CHARS } from '../../src/api/shared.ts';
import { CIRCLE_PAGE_SCRIPT, CIRCLE_TEXT_MAX_CHARS } from '../../src/mac/circle-page.ts';

/** 原生层用 callAsyncJavaScript 跑：脚本是一个 async 函数体。 */
function run(): Promise<string | null> {
  const body = new Function(`return (async () => {\n${CIRCLE_PAGE_SCRIPT}\n})();`) as () => Promise<string | null>;
  return body();
}

function layer(): Element {
  const found = document.querySelector('plasticine-circle');
  if (found === null) {
    throw new Error('没有盖上圈一块的那一层');
  }
  return found;
}

function pointer(type: string, x: number, y: number): void {
  layer().dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
}

/** jsdom 没有布局：按元素上的 data-rect（左 上 宽 高）给位置。 */
function fakeLayout(): void {
  const rectOf = (element: Element | null): DOMRect => {
    const [left = 0, top = 0, width = 0, height = 0] = (element?.getAttribute('data-rect') ?? '').split(' ')
      .map(Number);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
      toJSON: () => ({}) } as DOMRect;
  };
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value(this: Range) {
    const rect = rectOf(this.startContainer.parentElement ?? (this.startContainer as Element));
    return rect.width > 0 ? [rect] : [];
  } });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measure(this: Element) {
    return rectOf(this);
  });
}

const PAGE = `
<h1 data-rect="40 20 600 40">本地优先软件的同步难题</h1>
<p id="first" data-rect="40 80 600 60">把数据放在自己的设备上，离线也能用，<span data-rect="300 80 100 20">这是</span>最吸引人的地方。</p>
<img alt="一张同步示意图" data-rect="40 150 300 100">
<label data-rect="40 260 300 20">名字 <input value="不该被读出来的字"></label>
<p data-rect="40 400 600 60">冲突从哪里来</p>`;

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
  vi.restoreAllMocks();
  delete (window as { __plasticineCircleCancel?: unknown }).__plasticineCircleCancel;
});

describe('圈一块的注入脚本', () => {
  it('不拖直接点：回点的那个元素的字、这一页的地址和标题，盖的那一层收走', async () => {
    document.body.innerHTML = PAGE;
    document.title = '本地优先';
    const target = document.getElementById('first')!;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    const result = run();
    pointer('pointermove', 100, 100);
    pointer('pointerdown', 100, 100);
    pointer('pointerup', 102, 101);
    expect(JSON.parse((await result)!)).toEqual({ text: '把数据放在自己的设备上，离线也能用，这是最吸引人的地方。',
      url: window.location.href, title: '本地优先' });
    expect(document.querySelector('plasticine-circle')).toBeNull();
  });

  it('拖一个框：回框住的字，按块换行，图片带 alt，不读输入框里填的', async () => {
    document.body.innerHTML = PAGE;
    fakeLayout();
    const result = run();
    pointer('pointerdown', 30, 70);
    pointer('pointermove', 400, 200);
    pointer('pointerup', 700, 300);
    const { text } = JSON.parse((await result)!) as { text: string };
    expect(text).toBe('把数据放在自己的设备上，离线也能用，这是最吸引人的地方。\n名字\n〔图：一张同步示意图〕');
    expect(text).not.toContain('不该被读出来的字');
  });

  it('Esc 或原生取消：回 null', async () => {
    document.body.innerHTML = PAGE;
    const escaped = run();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await escaped).toBeNull();
    const cancelled = run();
    (window as { __plasticineCircleCancel?: () => void }).__plasticineCircleCancel?.();
    expect(await cancelled).toBeNull();
    expect(document.querySelector('plasticine-circle')).toBeNull();
  });

  it('上限和接口一致；Mac 的 Swift 带一份一字不差的脚本（iOS 工程 2026-11-05 删了）', () => {
    expect(CIRCLE_TEXT_MAX_CHARS).toBe(WEB_CIRCLE_TEXT_MAX_CHARS);
    expect(CIRCLE_PAGE_SCRIPT).toContain(`const MAX_CHARS = ${CIRCLE_TEXT_MAX_CHARS};`);
    for (const path of ['../../../mac/Sources/Plasticine/circle-page-script.swift']) {
      const swift = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(swift).toContain(`static let source = #"""\n${CIRCLE_PAGE_SCRIPT}\n"""#`);
    }
  });
});
