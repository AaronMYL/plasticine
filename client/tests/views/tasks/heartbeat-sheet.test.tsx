// 心跳的弹层（《优化清单》第 11 条，设计稿 Tasks-Heartbeat）：多久一次、安静时段、模型、看什么（能拖、能删、能用一句话改）、
// 最近几次。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedTasks } from '../../../src/api/fake/tasks-seed.ts';
import { NOW, renderApp } from '../../helpers.tsx';

async function openHeartbeat() {
  const app = await renderApp({ hash: '#/tasks/timed', setup: ({ control }) => seedTasks(control.tasks, NOW) });
  fireEvent.click(await screen.findByRole('button', { name: '打开：心跳' }));
  const sheet = await screen.findByRole('dialog', { name: '心跳' });
  await within(sheet).findByRole('list', { name: '看什么' });
  return { app, sheet };
}

describe('心跳的弹层', () => {
  it('写多久一次、安静时段、清单和最近几次', async () => {
    const { sheet } = await openHeartbeat();
    expect((within(sheet).getByRole('combobox', { name: '多久一次' }) as HTMLSelectElement).value).toBe('30');
    expect(within(sheet).getByText('23:00–08:00 不跳')).toBeTruthy();
    const items = within(within(sheet).getByRole('list', { name: '看什么' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toContain('要回复的邮件');
    expect(items).toHaveLength(7);
    expect(within(sheet).getByText('「评审会」邀请要回复 → 发了消息给你')).toBeTruthy();
    expect(within(sheet).getByRole('switch', { name: '心跳：开着' })).toBeTruthy();
  });

  it('改多久一次、删一条、键盘挪一条，都马上存', async () => {
    const { app, sheet } = await openHeartbeat();
    fireEvent.change(within(sheet).getByRole('combobox', { name: '多久一次' }), { target: { value: '60' } });
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.intervalMinutes).toBe(60));
    fireEvent.click(within(sheet).getByRole('button', { name: '删掉：信息流里命中关注点的' }));
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.items).toHaveLength(6));
    fireEvent.keyDown(within(sheet).getByRole('button', { name: '拖动排序：今天到期的项目待办' }), { key: 'ArrowUp' });
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.items.map((item) => item.id)
      .slice(-2)).toEqual(['due', 'friends']));
  });

  it('拖一条到别的位置', async () => {
    const { app, sheet } = await openHeartbeat();
    const list = within(sheet).getByRole('list', { name: '看什么' });
    const items = within(list).getAllByRole('listitem');
    fireEvent.dragStart(items[5]!);
    fireEvent.dragOver(items[0]!);
    fireEvent.drop(items[0]!);
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.items[0]?.id).toBe('due'));
  });

  it('一句话改：说「别再看信息流了」就删那一条；说新的就加一条', async () => {
    const { app, sheet } = await openHeartbeat();
    const input = within(sheet).getByRole('textbox', { name: '加一条，或者说怎么改' });
    fireEvent.change(input, { target: { value: '别再看信息流了' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.items.some((item) => item.id === 'feed'))
      .toBe(false));
    fireEvent.change(input, { target: { value: '快递到了没有' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await within(sheet).findByText('快递到了没有')).toBeTruthy();
  });
});
