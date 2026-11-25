import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedWorkScene } from '../../../src/api/fake/work-seed.ts';
import { doingLines } from '../../../src/views/home/home-now.tsx';
import { HOME_HEADING, NOW, renderApp } from '../../helpers.tsx';

describe('Home: Now section', () => {
  it('empty state shows direct composer that sends and enters conversation', async () => {
    await renderApp({ hash: '#/today' });
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '等你' })).toBeNull();
    expect(screen.queryByRole('region', { name: '在做' })).toBeNull();
    const start = await screen.findByRole('textbox', { name: '想一起做什么' });
    fireEvent.change(start, { target: { value: '帮我查一下安装来源' } });
    fireEvent.click(screen.getByRole('button', { name: '开始聊' }));
    expect(await screen.findByRole('complementary', { name: '对话框' })).toBeTruthy();
  });

  it('Waiting lists one card per row; View expands card inline for direct response', async () => {
    const app = await renderApp({ hash: '#/today', setup: ({ control }) => {
      control.asks.raise({ id: 'ask-1', kind: 'approve', basis: 'hard_line', question: '要把这封回复发给 Bolt 吗？',
        detail: '发出后对方会收到，撤不回', options: [{ id: 'allow', label: '发出', recommended: true,
          description: null }, { id: 'deny', label: '先不', recommended: false, description: null }] });
    } });
    const waiting = await screen.findByRole('region', { name: '等你' });
    expect(within(waiting).getByText('1')).toBeTruthy();
    fireEvent.click(within(waiting).getByRole('button', { name: '去看' }));
    const card = within(waiting).getByRole('region', { name: /要把这封回复发给 Bolt 吗/ });
    fireEvent.click(within(card).getByRole('button', { name: '发出（推荐）' }));
    await waitFor(async () => expect((await app.api.asks.get('ask-1')).status).toBe('answered'));
    await waitFor(() => expect(screen.queryByRole('region', { name: '等你' })).toBeNull());
  });

  it('Working pause leaves resumable task; thread stopped on a card is not duplicated', async () => {
    const app = await renderApp({ hash: '#/today', setup: ({ control }) => {
      const at = new Date().toISOString();
      control.lines.put(control.lines.blank('line-a', 'background', '查安装来源', { status: 'running',
        activity: '读官方发布页…', activeSince: at }));
      control.lines.put(control.lines.blank('line-b', 'background', '回 Bolt', { status: 'waiting' }));
    } });
    const doing = await screen.findByRole('region', { name: '在做' });
    expect(within(doing).getByText('查安装来源')).toBeTruthy();
    expect(within(doing).getByText('读官方发布页…')).toBeTruthy();
    expect(within(doing).queryByText('回 Bolt')).toBeNull();
    fireEvent.click(within(doing).getByRole('button', { name: '暂停' }));
    await waitFor(() => expect(app.control.lines.find('line-a')?.pauseReason).toBe('user'));
    expect(await within(doing).findByRole('button', { name: '继续' })).toBeTruthy();
    expect(within(doing).getByText('已暂停')).toBeTruthy();
  });

  it('two-column layout shows waiting/working counts under greeting and All Tasks link', async () => {
    await renderApp({ hash: '#/today', setup: ({ control }) => {
      control.lines.put(control.lines.blank('line-a', 'background', '查安装来源', { status: 'running',
        activeSince: new Date().toISOString() }));
    } });
    const doing = await screen.findByRole('region', { name: '在做' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('1 件在做');
    expect(doing.closest('.home-main')).not.toBeNull();
    fireEvent.click(within(doing).getByRole('button', { name: '全部任务' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/tasks/));
  });

  it('Working orders active runs first and excludes main chat, side chats, and completed items', () => {
    const base = { kind: 'background' as const, parentLineId: null, parentMessageSeq: null, projectId: null,
      title: '', pausedUntil: null,
      pauseReason: null, outcome: null,
      failure: null, activity: null, activeSince: null, queued: 0, lastAnswer: null, createdAt: '2026-11-05T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z' };
    const lines = [{ ...base, id: 'p', status: 'paused' as const }, { ...base, id: 'r', status: 'running' as const },
      { ...base, id: 'd', status: 'idle' as const },
      { ...base, id: 'm', kind: 'main' as const, status: 'running' as const },
      { ...base, id: 's', kind: 'side' as const, status: 'running' as const }];
    expect(doingLines(lines).map((line) => line.id)).toEqual(['r', 'p']);
  });

  it('Recent Results shows real completions only, excluding rework/paused, opening full output', async () => {
    await renderApp({ setup: ({ control }) => {
      for (const [id, title, status, outcome] of [
        ['done', '完整调研结果', 'idle', 'done'], ['edit', '排队返工', 'queued', null],
        ['paused', '已暂停的旧稿', 'paused', 'stopped'],
      ] as const) {
        control.lines.put(control.lines.blank(id, 'background', title, { status, outcome, lastAnswer: '已有的结果' }));
      }
    } });
    const recent = await screen.findByRole('region', { name: '新的' });
    expect(within(recent).getByText('完整调研结果')).toBeTruthy();
    expect(within(recent).queryByText('排队返工')).toBeNull();
    expect(within(recent).queryByText('已暂停的旧稿')).toBeNull();
    fireEvent.click(within(recent).getByRole('button', { name: /完整调研结果/ }));
    expect(await screen.findByRole('dialog', { name: '工作详情' })).toBeTruthy();
  });

  it('Recent Results marks success with check and failed runs with cross + reason', async () => {
    await renderApp({ setup: ({ control }) => {
      control.lines.put(control.lines.blank('ok', 'background', '刷新信息流', { outcome: 'done' }));
      control.lines.put(control.lines.blank('unmet', 'background', '设置每日续火花', { outcome: 'done',
        unmet: '当时还不能新建定时任务' }));
    } });
    const recent = await screen.findByRole('region', { name: '新的' });
    const ok = within(recent).getByRole('button', { name: /刷新信息流/ });
    expect(within(ok).getByRole('img', { name: '已完成' })).toBeTruthy();
    const unmet = within(recent).getByRole('button', { name: /设置每日续火花/ });
    expect(within(unmet).getByRole('img', { name: '没做成' })).toBeTruthy();
    expect(within(unmet).queryByRole('img', { name: '已完成' })).toBeNull();
    expect(within(unmet).getByText('没做成：当时还不能新建定时任务').className).toContain('home-result-unmet');
  });

  it('refresh error preserves loaded tasks with retry; initial load shows spinner not empty state', async () => {
    let release: (() => void) | undefined;
    let fail = false;
    const app = await renderApp({ setup: ({ api, control }) => {
      control.lines.put(control.lines.blank('done', 'background', '已经完成的调研', { outcome: 'done' }));
      const list = api.lines.list.bind(api.lines);
      api.lines.list = async (query) => {
        if (release === undefined) await new Promise<void>((resolve) => { release = resolve; });
        if (fail) throw new Error('连接中断');
        return list(query);
      };
    } });
    expect(screen.getByRole('status', { name: '正在读新的' })).toBeTruthy();
    await act(async () => release?.());
    expect(await screen.findByText('已经完成的调研')).toBeTruthy();
    fail = true;
    act(() => app.control.bus.emit({ type: 'resync' }));
    expect(await screen.findByText('刷新失败，保留上次结果')).toBeTruthy();
    expect(screen.getByText('已经完成的调研')).toBeTruthy();
    fail = false;
    fireEvent.click(within(screen.getByRole('region', { name: '新的' })).getByRole('button', { name: '再读一次' }));
    await waitFor(() => expect(screen.queryByText('刷新失败，保留上次结果')).toBeNull());
  });

  it('error scenario retains failure and arrived results after auto-reload, allowing manual retry', async () => {
    await renderApp({ setup: ({ control }) => seedWorkScene({ lines: control.lines, asks: control.asks,
      contacts: control.contacts, projectId: null }, NOW, 'error') });
    const recent = await screen.findByRole('region', { name: '新的' });
    expect(await within(recent).findByText('刷新失败，保留上次结果')).toBeTruthy();
    expect(within(recent).getByText('杭州周末带父母去的三个地方')).toBeTruthy();
    fireEvent.click(within(recent).getByRole('button', { name: '再读一次' }));
    await waitFor(() => expect(within(recent).getByRole('button', { name: '再读一次' }).hasAttribute('disabled'))
      .toBe(false));
    expect(within(recent).getByText('刷新失败，保留上次结果')).toBeTruthy();
  });
});
