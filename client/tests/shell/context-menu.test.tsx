import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenuLayer, contextItems } from '../../src/shell/context-menu.tsx';
import { CONTEXT_MENU_EVENT } from '../../src/shell/use-context-menu-close.ts';

function mount(html: string): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = html;
  document.body.append(box);
  return box;
}

function select(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('contextItems', () => {
  it('inputs delegate context menu to system menu', () => {
    const box = mount('<p>正文</p><textarea>草稿</textarea>');
    expect(contextItems(box.querySelector('textarea') as Element, 0, 0, vi.fn())).toBeNull();
  });

  it('row context menu matches the row overflow button menu', () => {
    const box = mount('<ul class="column"><li data-context-row><span>标题</span>'
      + '<button data-row-menu>⋯</button></li></ul>');
    const clicked = vi.fn();
    box.querySelector('button')?.addEventListener('click', clicked);
    expect(contextItems(box.querySelector('span') as Element, 10, 20, vi.fn())).toEqual([]);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('selected text in content area shows Quote and Copy', () => {
    const box = mount('<main><p>选中的这一段</p></main>');
    const text = box.querySelector('p') as Element;
    select(text);
    expect(contextItems(text, 0, 0, vi.fn())?.map((item) => item.label)).toEqual(['引用', '复制']);
  });

  it('message context menu shows Quote, React, and Copy; omits React in AI chats', () => {
    const box = mount(`<div data-context-message data-message-text="看到了"><p>看到了</p>
      <button data-message-action="react">表情</button><button data-message-action="quote">引用</button></div>
      <div data-context-message data-message-text="好的"><p>好的</p><button data-message-action="quote">引用</button></div>`);
    const [human, ai] = [...box.querySelectorAll('p')] as Element[];
    expect(contextItems(human as Element, 0, 0, vi.fn())?.map((item) => item.label))
      .toEqual(['引用这条', '加个表情', '复制这条']);
    expect(contextItems(ai as Element, 0, 0, vi.fn())?.map((item) => item.label)).toEqual(['引用这条', '复制这条']);
  });

  it('left sidebar areas without a menu show neither custom nor system menu', () => {
    const box = mount('<aside class="column"><h2>笔记</h2></aside><main><p>正文</p></main>');
    expect(contextItems(box.querySelector('h2') as Element, 0, 0, vi.fn())).toEqual([]);
    expect(contextItems(box.querySelector('p') as Element, 0, 0, vi.fn())).toBeNull();
  });
});

describe('ContextMenuLayer', () => {
  it('right-clicking selection closes selection bar first and Quote sends to composer', async () => {
    const add = vi.fn();
    render(<ContextMenuLayer add={add} />);
    const box = mount('<main><p>要引用的一段</p></main>');
    const text = box.querySelector('p') as HTMLElement;
    select(text);
    const closed = vi.fn();
    window.addEventListener(CONTEXT_MENU_EVENT, closed);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 });
    act(() => {
      text.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('menuitem', { name: /^引用/ }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ text: '要引用的一段' }));
    window.removeEventListener(CONTEXT_MENU_EVENT, closed);
  });
});
