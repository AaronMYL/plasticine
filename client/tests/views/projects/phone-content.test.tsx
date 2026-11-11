import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SearchResponse } from '../../../src/api/shared.ts';
import { parseHash, phoneRoute, routeHash } from '../../../src/shell/routes.ts';
import { PHONE_TABS } from '../../../src/shell/sections.ts';
import { renderApp } from '../../helpers.tsx';

describe('手机内容承接', () => {
  it('保留四个底栏入口，项目、记忆与不支持对象都保留目标地址；工作三种链接可往返', () => {
    expect(PHONE_TABS).toEqual(['now', 'plasticine', 'messages', 'notes', 'more']);
    for (const hash of ['#/projects/project_hunter', '#/memory/topics/memdoc-rules', '#/books/book_1/2/40']) {
      expect(routeHash(phoneRoute(parseHash(hash)))).toBe(hash);
    }
    for (const hash of ['#/work/line-bg', '#/work/task/nt_1', '#/work/group-task/gt_1']) {
      expect(routeHash(parseHash(hash))).toBe(hash);
      expect(parseHash(hash).view).toBe('work');
    }
  });

  it('项目深链能读待办和档案，手机没有编辑按钮，引用包含所读内容且复制保留对象链接', async () => {
    const copy = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    const app = await renderApp({ width: 390, hash: '#/projects/project_hunter', seed: true });
    await screen.findByRole('heading', { name: 'Cyber Hunter' });
    expect(screen.getByText('只读')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '改档案' })).toBeNull();
    expect(screen.getByText('域名解析')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制这份内容的链接' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(expect.stringContaining('#/projects/project_hunter')));
    fireEvent.click(screen.getByRole('button', { name: '在对话里提' }));
    await screen.findByRole('textbox', { name: '问一句' });
    expect(window.location.hash).toBe('#/projects/project_hunter');
    const quote = app.state.conversationUi.store.get().quotes[0];
    expect(quote?.text).toContain('域名解析');
    expect(quote?.text).toContain('放腾讯云，只转加密字节');
    fireEvent.click(screen.getByRole('button', { name: '关上对话' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '问一句' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Cyber Hunter' })).toBeTruthy();
  });

  it('记忆主题深链可读原文和来源，继续对话时带上实际小节内容', async () => {
    const app = await renderApp({ width: 390, hash: '#/memory/topics/memdoc-rules', seed: true });
    await screen.findByRole('heading', { name: '主线的 Soul' });
    expect(await screen.findByText('要你定的事一律给选项，推荐的放第一个。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认生效' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /回到原话/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '在对话里提' }));
    await screen.findByRole('textbox', { name: '问一句' });
    expect(app.state.conversationUi.store.get().quotes[0]?.text).toContain('推荐的放第一个');
  });

  it('读取记忆失败有重试，缺失对象不会被首页掩盖', async () => {
    const app = await renderApp({ width: 390, hash: '#/memory/topics/memdoc-rules', seed: true, setup: ({ api }) => {
      vi.spyOn(api.memoryTopics, 'get').mockRejectedValueOnce(new Error('读取中断，请重试'));
    } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByRole('heading', { name: '主线的 Soul' });
    expect(app.api.memoryTopics.get).toHaveBeenCalledTimes(2);
  });

  it('图书点开一本整屏读（2026-11-08）：阅读页手机版式，不画底栏，地址照旧', async () => {
    await renderApp({ width: 390, hash: '#/books/book_taoan', seed: true });
    expect(await screen.findByRole('button', { name: '回到图书馆' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '目录' })).toBeTruthy();
    expect(screen.queryByText('图书暂时不能在手机打开。')).toBeNull();
    expect(document.querySelector('.bk-phone-reader')).not.toBeNull();
    expect(window.location.hash).toBe('#/books/book_taoan');
  });

  it('不支持的页留在说明页，能复制原链接到电脑', async () => {
    const copy = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    await renderApp({ width: 390, hash: '#/projects' });
    expect(await screen.findByText('项目暂时不能在手机打开。')).toBeTruthy();
    expect(window.location.hash).toBe('#/projects');
    fireEvent.click(screen.getByRole('button', { name: '复制链接到电脑' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(expect.stringContaining('#/projects')));
  });

  it('别处修改同一项目后重读待办；其他项目、工作和笔记事件不触发整页读取', async () => {
    const app = await renderApp({ width: 390, hash: '#/projects/project_hunter', seed: true });
    await screen.findByRole('heading', { name: 'Cyber Hunter' });
    const get = vi.spyOn(app.api.projects, 'get');
    await act(async () => {
      await app.api.projects.addTodo('project_hunter', { requestId: 'todo-during-work', title: '核对邀请名单' });
    });
    await screen.findByText('核对邀请名单');
    expect(get).toHaveBeenCalledTimes(1);
    get.mockClear();
    act(() => app.control.bus.emit({ type: 'project.invalidated', projectId: 'another-project' }));
    act(() => app.control.bus.emit({ type: 'line', event: { type: 'line_text', lineId: 'project-work',
      delta: '还在写' } }));
    expect(get).not.toHaveBeenCalled();
    act(() => app.control.bus.emit({ type: 'note.invalidated', noteId: 'changed-note' }));
    expect(get).not.toHaveBeenCalled();
    act(() => app.control.bus.emit({ type: 'resync' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  });
});
