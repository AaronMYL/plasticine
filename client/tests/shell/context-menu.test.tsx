// 右键菜单（11-12 第 1、2 条）：能打字的地方交给系统；一行就是它的「⋯」；选中了字「引用 · 复制」；
// 一条消息「引用这条 · 加个表情 · 复制这条」；左侧栏里没有对应菜单就什么都不出；右键时选中后的小条收起。

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
  it('输入框里交给系统菜单', () => {
    const box = mount('<p>正文</p><textarea>草稿</textarea>');
    expect(contextItems(box.querySelector('textarea') as Element, 0, 0, vi.fn())).toBeNull();
  });

  it('一行的右键就是这一行的「⋯」', () => {
    const box = mount('<ul class="column"><li data-context-row><span>标题</span><button data-row-menu>⋯</button></li></ul>');
    const clicked = vi.fn();
    box.querySelector('button')?.addEventListener('click', clicked);
    expect(contextItems(box.querySelector('span') as Element, 10, 20, vi.fn())).toEqual([]);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('内容区选中了字：引用 · 复制', () => {
    const box = mount('<main><p>选中的这一段</p></main>');
    const text = box.querySelector('p') as Element;
    select(text);
    expect(contextItems(text, 0, 0, vi.fn())?.map((item) => item.label)).toEqual(['引用', '复制']);
  });

  it('点在一条消息上：引用这条 · 加个表情 · 复制这条；AI 对话没有表情就不出', () => {
    const box = mount(`<div data-context-message data-message-text="看到了"><p>看到了</p>
      <button data-message-action="react">表情</button><button data-message-action="quote">引用</button></div>
      <div data-context-message data-message-text="好的"><p>好的</p><button data-message-action="quote">引用</button></div>`);
    const [human, ai] = [...box.querySelectorAll('p')] as Element[];
    expect(contextItems(human as Element, 0, 0, vi.fn())?.map((item) => item.label))
      .toEqual(['引用这条', '加个表情', '复制这条']);
    expect(contextItems(ai as Element, 0, 0, vi.fn())?.map((item) => item.label)).toEqual(['引用这条', '复制这条']);
  });

  it('左侧栏里没有对应菜单的地方：什么都不出，也不给系统菜单', () => {
    const box = mount('<aside class="column"><h2>笔记</h2></aside><main><p>正文</p></main>');
    expect(contextItems(box.querySelector('h2') as Element, 0, 0, vi.fn())).toEqual([]);
    expect(contextItems(box.querySelector('p') as Element, 0, 0, vi.fn())).toBeNull();
  });
});

describe('ContextMenuLayer', () => {
  it('右键选中的字出自己的菜单，先发事件让选中小条收起；点「引用」交给对话框', async () => {
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
