// 首页「现在」（2026-11-05 设计稿 Home）：等你列开着的卡，「去看」就地摊开；在做列在跑的后台线，能停；空的块不出现。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedWorkScene } from '../../../src/api/fake/work-seed.ts';
import { doingLines } from '../../../src/views/home/home-now.tsx';
import { HOME_HEADING, NOW, renderApp } from '../../helpers.tsx';

describe('首页「现在」', () => {
  it('全空时有一个直接开始的输入框，发出后进入对话继续接结果', async () => {
    await renderApp({ hash: '#/today' });
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '等你' })).toBeNull();
    expect(screen.queryByRole('region', { name: '在做' })).toBeNull();
    const start = await screen.findByRole('textbox', { name: '想一起做什么' });
    fireEvent.change(start, { target: { value: '帮我查一下安装来源' } });
    fireEvent.click(screen.getByRole('button', { name: '开始聊' }));
    expect(await screen.findByRole('complementary', { name: '对话框' })).toBeTruthy();
  });

  it('等你：一行一张卡，「去看」在这一行下面摊开那张卡，能就地作答', async () => {
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

  it('在做：点暂停会留下可继续的工作，停在卡上的线不重复列', async () => {
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

  it('两栏：问候下面写几件要你定、几件在进行；进行中带「全部任务」，点了去任务', async () => {
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

  it('在做的顺序：在跑的在前，主对话、旁聊和做完的不列', () => {
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

  it('最近结果只列真实完成，排着返工和被暂停的旧结果不混进来；点击能读完整成果', async () => {
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

  it('最近结果：做成的打勾；跑完了但没做成的是叉，后面一句原因（旧记录没有这一项照旧打勾）', async () => {
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

  it('刷新工作失败保留已读结果，并能重试；第一次还没读到时显示加载而非假空态', async () => {
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

  it('错误验收场景在自动重读后仍保留故障与已到达的结果，重试可再次发起读取', async () => {
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
