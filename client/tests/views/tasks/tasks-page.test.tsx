// 任务栏目主区（《优化清单》第 3、4、5 条）：定时（下次 / 上次 / 开关 / 删，等确认的卡拨不了）、建议（开始做 / 加成待办 /
// 忽略）、在做（线、队友、刚做完带没做成的原因；点队友出弹层能叫停）；对话里的定时卡；手机的分段控件；设备报时区。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ideasSeed, seedScheduleScene, seedTasks, teammatesSeed, timedSeed } from '../../../src/api/fake/tasks-seed.ts';
import { NOW, renderApp } from '../../helpers.tsx';

describe('任务栏目', () => {
  it('定时：每行写下次、上次；拨开关停下；等确认的卡拨不了；删要先看后果再点', async () => {
    const app = await renderApp({ hash: '#/tasks/timed', setup: ({ control }) => seedTasks(control.tasks, NOW) });
    expect(await screen.findByRole('heading', { name: '定时' })).toBeTruthy();
    const list = screen.getByRole('list', { name: '定时' });
    expect(within(list).getByText('电脑不在线')).toBeTruthy();
    expect((within(list).getByRole('switch', { name: '抖音续火花：开着' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(list).getByRole('switch', { name: '同步抖音收藏：开着' }));
    await waitFor(async () => {
      const board = await app.api.tasks.board({});
      expect(board.timed.find((row) => row.id === 'schedule:douyin')?.enabled).toBe(false);
    });
    fireEvent.click(within(list).getByRole('button', { name: '「同步抖音收藏」的更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '删掉' }));
    const confirm = screen.getByRole('group', { name: '删掉「同步抖音收藏」' });
    expect(within(confirm).getByText('删掉后不再到点，已经做过的结果还在。')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: '删掉' }));
    await waitFor(() => expect(screen.queryByText('同步抖音收藏')).toBeNull());
  });

  it('定时：点开一行出右侧弹层，写做什么、下次、上次', async () => {
    await renderApp({ hash: '#/tasks/timed', setup: ({ control }) => seedTasks(control.tasks, NOW) });
    // 心跳有自己的弹层（heartbeat-sheet.test.tsx）；没登记弹层的（做梦）用默认的。
    fireEvent.click(await screen.findByRole('button', { name: '打开：做梦' }));
    const sheet = await screen.findByRole('dialog', { name: '做梦' });
    expect(within(sheet).getByText('每晚整理记忆')).toBeTruthy();
    expect(within(sheet).getByText('整理了 11 条')).toBeTruthy();
    expect(within(sheet).getByRole('switch', { name: '做梦：开着' })).toBeTruthy();
  });

  it('定时弹层里点「看这条线做了什么」：先收起定时这一层再开工作详情，关一次就回到列表', async () => {
    await renderApp({ hash: '#/tasks/timed', setup: ({ control }) => {
      const timed = timedSeed(NOW).map((row) => (row.id === 'dream' ? { ...row, lineId: 'line-dream' } : row));
      control.tasks.seed({ timed, teammates: teammatesSeed(), ideas: ideasSeed(NOW) });
      control.lines.put(control.lines.blank('line-dream', 'background', '整理记忆', { status: 'idle',
        outcome: 'done' }));
    } });
    fireEvent.click(await screen.findByRole('button', { name: '打开：做梦' }));
    const sheet = await screen.findByRole('dialog', { name: '做梦' });
    fireEvent.click(within(sheet).getByRole('button', { name: '看这条线做了什么' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '做梦' })).toBeNull());
    await waitFor(() => expect(window.location.hash).toContain('line-dream'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('建议：开始做开一条线；加成待办、忽略都收起来', async () => {
    const app = await renderApp({ hash: '#/tasks/ideas', setup: ({ control }) => seedTasks(control.tasks, NOW) });
    const list = await screen.findByRole('list', { name: '建议' });
    const first = within(list).getByRole('listitem', { name: '建议：把悬赏规则整理成公开页' });
    fireEvent.click(within(first).getByRole('button', { name: '开始做' }));
    await waitFor(() => expect(app.control.lines.find('line-idea-idea-rules')?.status).toBe('running'));
    const second = within(list).getByRole('listitem', { name: '建议：回复「下周三的评审会」邀请' });
    fireEvent.click(within(second).getByRole('button', { name: '加成待办' }));
    const third = within(list).getByRole('listitem', { name: '建议：给《思考，快与慢》做一页读书笔记' });
    fireEvent.click(within(third).getByRole('button', { name: '忽略' }));
    await waitFor(async () => expect((await app.api.tasks.board({})).ideas.map((idea) => idea.id))
      .toEqual(['idea-biorxiv']));
  });

  it('进行中：只放在做的线；Plasticine 的例行事不再单列一栏，跑起来时作为一条线出现；已结束不列没跑完的', async () => {
    await renderApp({ hash: '#/tasks', setup: ({ control }) => {
      seedTasks(control.tasks, NOW);
      control.lines.put(control.lines.blank('line-weekly', 'background', '研究周报 · 第 3 期', { status: 'running',
        activity: '读到第 9 / 14 篇', activeSince: new Date(NOW.getTime() - 12 * 60_000).toISOString() }));
      control.lines.put(control.lines.blank('line-spark', 'background', '设置每日续火花', { status: 'idle',
        outcome: 'done', unmet: '当时还不能新建定时任务' }));
    } });
    const running = await screen.findByRole('list', { name: '在做' });
    expect(within(running).getByText('读到第 9 / 14 篇')).toBeTruthy();
    expect(within(running).queryByText('设置每日续火花')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Plasticine' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Plasticine：回顾' })).toBeNull();
  });

  it('四个动作：暂停后能继续；停止要确认、进已结束；删除就地撤销，最近删除里能恢复', async () => {
    const app = await renderApp({ hash: '#/tasks', setup: ({ control }) => {
      control.lines.put(control.lines.blank('line-bills', 'background', '整理 11 月账单', { status: 'running',
        activity: '读第 3 张账单', activeSince: NOW.toISOString() }));
      control.lines.put(control.lines.blank('line-blog', 'background', '翻译博客', { status: 'paused',
        pauseReason: 'user' }));
    } });
    const running = await screen.findByRole('list', { name: '在做' });
    expect(within(running).getByRole('button', { name: '继续' })).toBeTruthy();
    fireEvent.click(within(running).getByRole('button', { name: '更多操作：整理 11 月账单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '停止…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('停止后不能再继续。做过的过程和结果保留在「已结束」里。')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '停止' }));
    await waitFor(async () => {
      const board = await app.api.tasks.board({});
      expect(board.ended.map((line) => line.id)).toContain('line-bills');
    });
    fireEvent.click(within(running).getByRole('button', { name: '更多操作：翻译博客' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    expect(await screen.findByText('已删除「翻译博客」')).toBeTruthy();
    expect((await app.api.tasks.board({})).deleted.map((line) => line.id)).toEqual(['line-blog']);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(async () => expect((await app.api.tasks.board({})).deleted).toEqual([]));
  });

  it('对话里的定时卡：名单、发什么、什么时候、后果常显；点确认就答了这张卡', async () => {
    const app = await renderApp({ hash: '#/messages/plasticine', setup: ({ control }) => {
      seedScheduleScene(control.lines, (seed) => control.asks.raise(seed), NOW);
    } });
    const card = await screen.findByRole('region', { name: '等你授权：每天 15:00 · 抖音续火花' });
    expect(within(card).getByText('Kiki')).toBeTruthy();
    expect(within(card).getByText('每人一个表情，每天随机换')).toBeTruthy();
    expect(within(card).getByText('你所在地的时间')).toBeTruthy();
    expect(within(card).getByText(/确认后，每天会以你的名义发出/)).toBeTruthy();
    expect(within(card).getByText('归「个人」')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '确认，每天照做（推荐）' }));
    await waitFor(async () => expect((await app.api.asks.get('ask-schedule-spark')).answer?.optionId)
      .toBe('confirm'));
  });

  it('手机：标题下分段控件带个数，点了换一段', async () => {
    await renderApp({ width: 390, hash: '#/tasks/timed', setup: ({ control }) => seedTasks(control.tasks, NOW) });
    const tabs = await screen.findByRole('group', { name: '任务' });
    await waitFor(() => expect(within(tabs).getByText('7')).toBeTruthy());
    fireEvent.click(within(tabs).getByText('建议'));
    expect(await screen.findByRole('list', { name: '建议' })).toBeTruthy();
    expect(window.location.hash).toBe('#/tasks/ideas');
  });

  it('打开时把这台设备的时区报给 Plasticine', async () => {
    const app = await renderApp({ hash: '#/today' });
    await waitFor(() => expect(app.control.tasks.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone));
  });
});

describe('项目页里的任务', () => {
  it('只列这个项目的定时和建议（和任务栏目同一份数据）', async () => {
    await renderApp({ hash: '#/projects/project-plasticine', setup: ({ control }) => {
      control.projects.seed({ id: 'project-plasticine', name: 'Plasticine' });
      seedTasks(control.tasks, NOW);
    } });
    const timed = await screen.findByRole('region', { name: '这个项目的定时' });
    expect(within(timed).getByText('认知与神经科学研究周报')).toBeTruthy();
    expect(within(timed).queryByText('心跳')).toBeNull();
    const ideas = screen.getByRole('region', { name: '这个项目的建议' });
    expect(within(ideas).getByText('研究周报加一个来源：bioRxiv 神经科学')).toBeTruthy();
    expect(within(ideas).queryByText('把悬赏规则整理成公开页')).toBeNull();
  });
});
