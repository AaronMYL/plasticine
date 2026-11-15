// 主动告诉你（记忆分层，11-15 Aaron 看过设计稿）：想听的（心跳清单：能拖、能删、能用一句话改）、别提的、什么时候（心跳开关、
// 多久看一次、不打扰的时段、模型，加上他说的）、怎么通知、最近几次。任务 · 定时里心跳那一行点开直接到这一页，不再弹浮层。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedTasks } from '../../../src/api/fake/tasks-seed.ts';
import { NOW, renderApp } from '../../helpers.tsx';

const main = (): HTMLElement => screen.getByRole('main');

async function openProactive() {
  const app = await renderApp({ hash: '#/memory/topics/memdoc-proactive',
    setup: ({ control }) => {
      seedTasks(control.tasks, NOW);
      control.memoryTopics.seed();
    } });
  const sheet = main();
  await within(sheet).findByRole('list', { name: '想听的' });
  return { app, sheet };
}

async function choose(label: string, option: string): Promise<void> {
  fireEvent.click(within(main()).getByRole('button', { name: label }));
  fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: option }));
}

describe('主动告诉你', () => {
  it('五块：想听的、别提的、什么时候、怎么通知、最近；他说的话一行一条', async () => {
    const { sheet } = await openProactive();
    expect(within(sheet).getAllByRole('region').map((region) => region.getAttribute('aria-labelledby')))
      .toEqual(['proactive-want', 'proactive-never', 'proactive-when', 'proactive-style', 'proactive-recent']);
    const items = within(within(sheet).getByRole('list', { name: '想听的' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toContain('要回复的邮件');
    expect(items).toHaveLength(7);
    const never = within(sheet).getByRole('region', { name: /^别提的/ });
    expect(within(never).getByText('周末不提工作上的事')).toBeTruthy();
    const when = within(sheet).getByRole('region', { name: '什么时候' });
    expect((within(when).getByRole('switch', { name: '心跳' }) as HTMLInputElement).checked).toBe(true);
    expect(within(when).getByRole('button', { name: '多久看一次' }).textContent).toBe('每 30 分钟');
    expect(within(when).getByRole('button', { name: '不打扰从几点' }).textContent).toBe('23:00');
    expect(within(when).getByRole('button', { name: '不打扰到几点' }).textContent).toBe('08:00');
    expect(within(when).getByText('开会的时候不打扰')).toBeTruthy();
    expect(within(within(sheet).getByRole('region', { name: '怎么通知' })).getByRole('button', { name: '通知哪些事' }))
      .toBeTruthy();
    expect(within(sheet).getByText('「评审会」邀请要回复 → 发了消息给你')).toBeTruthy();
  });

  it('改多久看一次、不打扰的时段、关掉心跳、删一条、键盘挪一条，都马上存', async () => {
    const { app, sheet } = await openProactive();
    await choose('多久看一次', '每 1 小时');
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.intervalMinutes).toBe(60));
    await choose('不打扰从几点', '22:30');
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.quietFrom).toBe('22:30'));
    expect((await app.api.tasks.heartbeat()).config.quietTo).toBe('08:00');
    fireEvent.click(within(sheet).getByRole('switch', { name: '心跳' }));
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).enabled).toBe(false));
    fireEvent.click(within(sheet).getByRole('button', { name: '删除：信息流里命中关注点的' }));
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.items).toHaveLength(6));
    fireEvent.keyDown(within(sheet).getByRole('button', { name: '拖动排序：今天到期的项目待办' }), { key: 'ArrowUp' });
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.items.map((item) => item.id)
      .slice(-2)).toEqual(['due', 'friends']));
  });

  it('拖一条到别的位置', async () => {
    const { app, sheet } = await openProactive();
    const list = within(sheet).getByRole('list', { name: '想听的' });
    const items = within(list).getAllByRole('listitem');
    fireEvent.dragStart(items[5]!);
    fireEvent.dragOver(items[0]!);
    fireEvent.drop(items[0]!);
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.items[0]?.id).toBe('due'));
  });

  it('一句话改：说「别再看信息流了」就删那一条；说新的就加一条', async () => {
    const { app, sheet } = await openProactive();
    const input = within(sheet).getByRole('textbox', { name: '加一条，或者说怎么改' });
    fireEvent.change(input, { target: { value: '别再看信息流了' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(async () => expect((await app.api.tasks.heartbeat()).config.items.some((item) => item.id === 'feed'))
      .toBe(false));
    fireEvent.change(input, { target: { value: '快递到了没有' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await within(sheet).findByText('快递到了没有')).toBeTruthy();
  });

  it('往「别提的」加一条：进这一段，记成你说的', async () => {
    const { app, sheet } = await openProactive();
    const never = within(sheet).getByRole('region', { name: /^别提的/ });
    fireEvent.click(within(never).getByRole('button', { name: '加一条' }));
    fireEvent.change(within(never).getByRole('textbox', { name: '加一条记忆' }), { target: { value: '促销信息不用说' } });
    fireEvent.click(within(never).getByRole('button', { name: '保存' }));
    expect(await within(never).findByText('促销信息不用说')).toBeTruthy();
    const doc = await app.api.memoryTopics.get('memdoc-proactive');
    expect(doc.sections.find((section) => section.section === 'never')?.lines.map((line) => line.text))
      .toContain('促销信息不用说');
  });

  it('任务 · 定时里心跳那一行点开直接到这一页，不弹浮层', async () => {
    await renderApp({ hash: '#/tasks/timed', setup: ({ control }) => {
      seedTasks(control.tasks, NOW);
      control.memoryTopics.seed();
    } });
    fireEvent.click(await screen.findByRole('button', { name: '打开：心跳' }));
    await waitFor(() => expect(window.location.hash).toBe('#/memory/topics/memdoc-proactive'));
    expect(await within(main()).findByRole('list', { name: '想听的' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '心跳' })).toBeNull();
  });
});
