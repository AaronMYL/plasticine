// 卡片、深链接与详情使用同一任务；无意见返工先补充，接手不会被当作恢复 AI 执行。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedWorkScene } from '../../../src/api/fake/work-seed.ts';
import { seedNetworkScene } from '../../../src/api/fake/network-seed.ts';
import { NOW, renderApp } from '../../helpers.tsx';

async function revision() {
  const app = await renderApp({ hash: '#/work/task/work-task', setup: ({ control }) => {
    seedWorkScene({ lines: control.lines, asks: control.asks, contacts: control.contacts, projectId: null },
      NOW, 'revision');
  } });
  const dialog = await screen.findByRole('dialog', { name: '工作详情' });
  await within(dialog).findByRole('textbox', { name: '修改意见' });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '我来处理' })
    .hasAttribute('disabled')).toBe(false));
  return { ...app, dialog };
}

describe('联系人和群的统一工作详情', () => {
  it('空意见返工只有一个输入框；填具体意见后继续原任务与原线，旧交付留着', async () => {
    const { dialog, control } = await revision();
    const submit = within(dialog).getByRole('button', { name: '让 Plasticine 继续' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText('等你决定')).toBeTruthy();
    expect(within(dialog).queryByText('已完成')).toBeNull();
    expect(await within(dialog).findByRole('heading', { name: /已保留的结果/ })).toBeTruthy();
    expect(within(dialog).queryByRole('textbox', { name: '补充这件事' })).toBeNull();
    fireEvent.change(within(dialog).getByRole('textbox', { name: '修改意见' }), {
      target: { value: '补上安装日期和核对依据' },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(control.contacts.task('work-task').state).toBe('in_progress'));
    expect(control.contacts.task('work-task').localTaskId).toBe('line-work');
    expect(control.contacts.task('work-task').delivery?.text).toContain('Cua');
    expect(control.lines.messagesOf('line-work').at(-1)?.text).toContain('补上安装日期和核对依据');
    await waitFor(() => expect(within(dialog).queryByRole('textbox', { name: '修改意见' })).toBeNull());
  });

  it('我来处理不需要先编修改意见，接手后可提交自己的交付', async () => {
    const { dialog, control } = await revision();
    fireEvent.click(within(dialog).getByRole('button', { name: '我来处理' }));
    await waitFor(() => expect(control.contacts.task('work-task').doer).toBe('person'));
    expect(control.lines.find('line-work')?.pauseReason).toBe('user');
    expect(control.contacts.task('work-task').localTaskId).toBe('line-work');
    expect(await within(dialog).findByText('你在处理')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: '继续' })).toBeNull();
    expect(within(dialog).queryByRole('textbox', { name: '补充这件事' })).toBeNull();
    fireEvent.click(await within(dialog).findByRole('button', { name: '历史版本' }));
    const history = within(dialog).getByLabelText('历史版本');
    fireEvent.click(history.querySelector('summary')!);
    expect(within(history).getByText('已找到应用签名，安装时间还需要核对。')).toBeTruthy();
    const input = await within(dialog).findByRole('textbox', { name: '交付「查 CuaDriver 的安装来源」' });
    fireEvent.change(input, { target: { value: '本人核对后的最终内容' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '交付' }));
    await waitFor(() => expect(control.contacts.task('work-task').delivery?.text).toBe('本人核对后的最终内容'));
    expect(await within(dialog).findByText('本人核对后的最终内容')).toBeTruthy();
    expect(control.contacts.task('work-task').localTaskId).toBe('line-work');
  });

  it('群任务卡进入同一详情；关闭后回原群，不把任务替换成新的主导航', async () => {
    await renderApp({ hash: '#/messages/grp-hangzhou', setup: ({ control }) => {
      seedNetworkScene({ contacts: control.contacts, network: control.network }, NOW, 'alex');
    } });
    const title = '周六中午帮忙订一桌川菜，6 个人，老人能吃的';
    fireEvent.click(await screen.findByRole('button', { name: `查看工作：${title}` }));
    const dialog = await screen.findByRole('dialog', { name: '工作详情' });
    expect(await within(dialog).findByRole('button', { name: '我来接' })).toBeTruthy();
    expect(window.location.hash).toBe('#/work/group-task/gt_lunch');
    fireEvent.click(within(dialog).getByRole('button', { name: '关掉工作详情' }));
    await waitFor(() => expect(window.location.hash).toBe('#/messages/grp-hangzhou'));
    expect(screen.getByRole('log', { name: '和杭州周末的聊天记录' })).toBeTruthy();
  });
});
