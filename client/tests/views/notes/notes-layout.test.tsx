import type { Editor } from '@tiptap/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, seedNote } from '../../helpers.tsx';

afterEach(() => vi.unstubAllGlobals());

async function editor(): Promise<Editor> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement & { editor?: Editor }>('.note-body .ProseMirror');
    if (element?.editor === undefined) throw new Error('正文尚未就绪');
    return element.editor;
  });
}

function observeWorkspace(): (width: number) => void {
  let resize: ((width: number) => void) | undefined;
  let currentWidth = 1200;
  vi.stubGlobal('ResizeObserver', class {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element): void {
      if (!target.classList.contains('notes-columns')) return;
      resize = (width) => this.callback([{ target, contentRect: { width } } as ResizeObserverEntry],
        this as unknown as ResizeObserver);
      resize(currentWidth);
    }
    unobserve(): void {}
    disconnect(): void {}
  });
  return (width) => {
    currentWidth = width;
    expect(resize).toBeTypeOf('function');
    act(() => resize?.(width));
  };
}

describe('笔记阅读布局', () => {
  it('文件夹管理按需打开独立面板，关闭保留未提交名称并把焦点还给入口', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 内容', { folder: '研究资料' });
    } });
    const folderBar = await screen.findByRole('complementary', { name: '笔记文件夹' });
    expect(within(folderBar).queryByLabelText('文件夹名称')).toBeNull();
    const manage = await screen.findByRole('button', { name: '管理文件夹研究资料' });
    manage.focus();
    fireEvent.click(manage);
    const panel = screen.getByRole('dialog', { name: '管理文件夹' });
    expect(folderBar.contains(panel)).toBe(false);
    fireEvent.change(within(panel).getByLabelText('文件夹名称'), { target: { value: '还在考虑的名称' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '管理文件夹' })).toBeNull();
    expect(document.activeElement).toBe(manage);
    expect((await app.api.notes.get('n1')).folder).toBe('研究资料');
    fireEvent.click(manage);
    expect(screen.getByLabelText('文件夹名称')).toHaveProperty('value', '还在考虑的名称');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(manage);
    expect(screen.getByLabelText('文件夹名称')).toHaveProperty('value', '研究资料');
  });

  it('文件夹一直在第二栏；主区变窄让出列表，正文与光标草稿保持原编辑器，返回列表保留搜索', async () => {
    const resize = observeWorkspace();
    await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 阅读空间\n\n保留上下文', { folder: '研究资料' });
    } });
    const original = await editor();
    act(() => original.commands.insertContentAt(original.state.doc.content.size, '<p>还在写的草稿</p>'));
    const selection = original.state.selection.from;
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索笔记' }), { target: { value: '阅读' } });
    const column = screen.getByRole('complementary', { name: '笔记' });
    expect(within(column).getByRole('complementary', { name: '笔记文件夹' })).toBeTruthy();
    expect(within(screen.getByRole('main')).queryByRole('complementary', { name: '笔记文件夹' })).toBeNull();
    expect(screen.queryByRole('button', { name: '选择文件夹' })).toBeNull();
    resize(920);
    expect(screen.getByRole('searchbox', { name: '搜索笔记' })).toBeTruthy();
    expect((await editor()) === original).toBe(true);
    resize(600);
    expect(screen.queryByRole('searchbox', { name: '搜索笔记' })).toBeNull();
    expect((await editor()) === original).toBe(true);
    expect(original.state.selection.from).toBe(selection);
    expect(original.getText()).toContain('还在写的草稿');
    fireEvent.click(screen.getByRole('button', { name: '返回笔记列表' }));
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    expect(screen.getByRole('searchbox', { name: '搜索笔记' })).toHaveProperty('value', '阅读');
    fireEvent.click(await screen.findByRole('button', { name: /^阅读空间/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/notes/n1'));
    expect((await editor()).getText()).toContain('还在写的草稿');
  });

  it('第二栏里切文件夹、建文件夹；长名称保持完整可读的入口', async () => {
    const name = 'project-cyber-hunter · 很长的研究资料文件夹';
    await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 研究条目', { folder: name });
    } });
    await editor();
    const column = screen.getByRole('complementary', { name: '笔记' });
    const target = await within(column).findByRole('button', { name: `${name} 1` });
    expect(target.getAttribute('title')).toBe(name);
    fireEvent.click(target);
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    expect(target.getAttribute('aria-current')).toBe('true');
    fireEvent.click(within(column).getByRole('button', { name: '新建文件夹' }));
    const create = screen.getByRole('dialog', { name: '新建文件夹' });
    fireEvent.change(within(create).getByLabelText('文件夹名称'), { target: { value: '新建资料' } });
    fireEvent.click(within(create).getByRole('button', { name: '创建文件夹' }));
    await screen.findByRole('button', { name: '新建资料 0' });
  });

  it('列表省去默认文件夹重复标签，标题操作仍有独立可辨认名称', async () => {
    await renderApp({ hash: '#/notes', setup: (fake) => {
      seedNote(fake, 'n1', '# 默认目录条目\n\n正文摘要', { folder: '笔记' });
      seedNote(fake, 'n2', '# 专题条目\n\n专题内容', { folder: '专题' });
    } });
    const note = await screen.findByRole('button', { name: /^默认目录条目/ });
    expect(within(note).queryByText('笔记')).toBeNull();
    expect(screen.getByLabelText('《默认目录条目》的操作')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /^专题条目/ })).getByText('专题')).toBeTruthy();
  });
});
