import type { Editor } from '@tiptap/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, seedNote } from '../../helpers.tsx';
import { noteColumn, openFolders } from './folders.ts';

afterEach(() => vi.unstubAllGlobals());

async function editor(): Promise<Editor> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement & { editor?: Editor }>('.note-body .ProseMirror');
    if (element?.editor === undefined) throw new Error('正文尚未就绪');
    return element.editor;
  });
}

describe('Note reading layout', () => {
  it('folder manager opens panel on demand, preserves uncommitted name on close, restores focus', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 内容', { folder: '研究资料' });
    } });
    const folders = await openFolders();
    expect(within(folders).queryByLabelText('文件夹名称')).toBeNull();
    const toggle = screen.getByRole('button', { name: '选择文件夹' });
    fireEvent.click(await within(folders).findByRole('button', { name: '管理文件夹研究资料' }));
    expect(screen.queryByRole('dialog', { name: '文件夹' })).toBeNull();
    const panel = screen.getByRole('dialog', { name: '管理文件夹' });
    fireEvent.change(within(panel).getByLabelText('文件夹名称'), { target: { value: '还在考虑的名称' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '管理文件夹' })).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect((await app.api.notes.get('n1')).folder).toBe('研究资料');
    fireEvent.click(within(await openFolders()).getByRole('button', { name: '管理文件夹研究资料' }));
    expect(screen.getByLabelText('文件夹名称')).toHaveProperty('value', '还在考虑的名称');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(within(await openFolders()).getByRole('button', { name: '管理文件夹研究资料' }));
    expect(screen.getByLabelText('文件夹名称')).toHaveProperty('value', '研究资料');
  });

  it('desktop uses 2nd column for list and main for body without remounting editor on search/switch', async () => {
    await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 阅读空间\n\n保留上下文', { folder: '研究资料' });
      seedNote(fake, 'n2', '# 另一篇', { folder: '笔记' });
    } });
    const original = await editor();
    act(() => original.commands.insertContentAt(original.state.doc.content.size, '<p>还在写的草稿</p>'));
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('searchbox', { name: '搜索笔记' })).toBeNull();
    expect(within(main).queryByRole('button', { name: '选择文件夹' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: '笔记文件夹' })).toBeNull();
    const column = noteColumn();
    const toggle = within(column).getByRole('button', { name: '选择文件夹' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(column).getByRole('button', { name: '新建笔记' })).toBeTruthy();
    fireEvent.change(within(column).getByRole('searchbox', { name: '搜索笔记' }), { target: { value: '阅读' } });
    fireEvent.click(toggle);
    const folders = await screen.findByRole('dialog', { name: '文件夹' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(folders).getByRole('button', { name: '新建文件夹' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '文件夹' })).toBeNull());
    fireEvent.click(await within(column).findByRole('button', { name: /^阅读空间/ }));
    expect((await editor()) === original).toBe(true);
    expect(original.getText()).toContain('还在写的草稿');
    expect(within(column).getByRole('searchbox', { name: '搜索笔记' })).toHaveProperty('value', '阅读');
  });

  it('folder list switches and creates folders while keeping long names fully readable', async () => {
    const name = 'project-cyber-hunter · 很长的研究资料文件夹';
    await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 研究条目', { folder: name });
    } });
    await editor();
    const target = await within(await openFolders()).findByRole('button', { name: `${name} 1` });
    expect(target.querySelector('.note-folder-name')?.textContent).toBe(name);
    expect(target.hasAttribute('title')).toBe(false);
    fireEvent.click(target);
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    expect(screen.queryByRole('dialog', { name: '文件夹' })).toBeNull();
    expect(within(noteColumn()).getByRole('button', { name: '选择文件夹' }).textContent).toContain(name);
    const reopened = await openFolders();
    expect(within(reopened).getByRole('button', { name: `${name} 1` }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(within(reopened).getByRole('button', { name: '新建文件夹' }));
    const create = screen.getByRole('dialog', { name: '新建文件夹' });
    fireEvent.change(within(create).getByLabelText('文件夹名称'), { target: { value: '新建资料' } });
    fireEvent.click(within(create).getByRole('button', { name: '创建文件夹' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建文件夹' })).toBeNull());
    expect(await within(await openFolders()).findByRole('button', { name: '新建资料 0' })).toBeTruthy();
  });

  it('list omits redundant default folder tag while keeping distinct accessible title actions', async () => {
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
