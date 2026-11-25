import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MAIN_LINE_ID } from '../../../src/api/fake/fake-lines.ts';
import { seedTasks } from '../../../src/api/fake/tasks-seed.ts';
import type { LinePlanStep } from '../../../src/api/shared.ts';
import { planProgress, planText } from '../../../src/views/lines/plan-text.ts';
import { NOW, renderApp } from '../../helpers.tsx';

const PLAN: LinePlanStep[] = [{ text: '打开消息页', status: 'done' }, { text: '排除投过的', status: 'skipped' },
  { text: '打招呼 · 37 / 200', status: 'running' }, { text: '看回复', status: 'todo' }, { text: '整理成表', status: 'todo' }];

describe('Step checklist', () => {
  it('shows current step, progress bar, and task row label', () => {
    expect(planProgress(PLAN)).toMatchObject({ current: 3, total: 5, ratio: 0.5 });
    expect(planText(PLAN)).toBe('第 3 步，共 5 步：打招呼 · 37 / 200');
    expect(planText(PLAN.map((step) => ({ ...step, status: 'done' as const })))).toBeNull();
    expect(planText(null)).toBeNull();
  });

  it('work detail renders steps at top and task row shows Step 3 of 5', async () => {
    await renderApp({ hash: '#/work/line-plan', setup({ control }) {
      control.lines.put(control.lines.blank('line-plan', 'background', '海投打招呼', { parentLineId: MAIN_LINE_ID,
        status: 'running', activity: '在打招呼', activeSince: NOW.toISOString(), plan: PLAN }));
    } });
    const steps = await screen.findByRole('region', { name: '步骤' });
    expect(within(steps).getByText('3 / 5')).toBeTruthy();
    expect(within(steps).getAllByRole('listitem').map((item) => item.getAttribute('data-status')))
      .toEqual(['done', 'skipped', 'running', 'todo', 'todo']);
    expect(within(steps).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3');
  });
});

describe('Settings - AI - Connections', () => {
  it('lists connections with failure reason and Retry; adding tests connection, fetches tools, saves', async () => {
    const app = await renderApp({ hash: '#/settings/ai', setup({ control }) {
      control.connections.seed({ requestId: 'req_seed_one', name: '示例笔记', url: 'https://mcp.example.com/notes' });
      control.connections.seed({ requestId: 'req_seed_two', name: '示例表格', url: 'https://mcp.example.com/fail' },
        true);
    } });
    const section = await screen.findByRole('region', { name: '连接' });
    await within(section).findByText('示例笔记');
    expect(within(section).getByText(/4 个工具 · 读的直接用，会改的按承诺和授权/)).toBeTruthy();
    expect(within(section).getByText(/没连上：令牌过期了/)).toBeTruthy();
    expect(within(section).getByRole('button', { name: '重试' })).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: /^示例笔记\s*4 个工具/ }));
    expect(within(section).getByRole('list', { name: '示例笔记给的工具' }).textContent).toContain('会改：按承诺和授权');
    fireEvent.click(within(section).getByRole('button', { name: '添加连接' }));
    const dialog = await screen.findByRole('dialog', { name: '添加连接' });
    fireEvent.change(within(dialog).getByLabelText('名字'), { target: { value: '示例看板' } });
    fireEvent.change(within(dialog).getByLabelText('连接地址'), { target: { value: 'https://mcp.example.com/board' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '测试连接' }));
    expect((await within(dialog).findByRole('status')).textContent).toBe('拿到 4 个工具');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加连接' })).toBeNull());
    expect((await app.api.connections.list()).map((item) => item.name)).toEqual(['示例笔记', '示例表格', '示例看板']);
  });

  it('canceling after test deletes the newly saved connection', async () => {
    const app = await renderApp({ hash: '#/settings/ai' });
    const section = await screen.findByRole('region', { name: '连接' });
    fireEvent.click(within(section).getByRole('button', { name: '添加连接' }));
    const dialog = await screen.findByRole('dialog', { name: '添加连接' });
    fireEvent.change(within(dialog).getByLabelText('名字'), { target: { value: '示例看板' } });
    fireEvent.change(within(dialog).getByLabelText('连接地址'), { target: { value: 'https://mcp.example.com/board' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '测试连接' }));
    await within(dialog).findByRole('status');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(async () => expect(await app.api.connections.list()).toEqual([]));
  });
});

describe('Proactive alerts - mobile push history', () => {
  it('lists one row per push with content, sender, and time; retracted item strikes through', async () => {
    const app = await renderApp({ hash: '#/memory/topics/memdoc-proactive', setup({ control }) {
      seedTasks(control.tasks, NOW);
      control.memoryTopics.seed();
      control.pushes.seed({ id: 'push_one', title: '示例科技回你了', from: '求职顾问', lineId: MAIN_LINE_ID,
        url: '/#/plasticine' }, 5);
    } });
    const list = await screen.findByRole('list', { name: '推到手机的' });
    expect(within(list).getByText(/求职顾问 · 推到手机 ·/)).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: '这条推送的更多操作：示例科技回你了' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '撤回' }));
    await waitFor(() => expect(within(list).getByText(/求职顾问 · 已撤回 ·/)).toBeTruthy());
    expect((await app.api.pushes.list())[0]?.withdrawnAt).not.toBeNull();
  });
});
