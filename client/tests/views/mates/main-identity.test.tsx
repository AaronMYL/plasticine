// 第 12 批：主线的名字可以自己起（11-13 起头像是泥团加漩涡，编辑主线改名字和画风）；
// 改了以后栏目、主线那一行、输入框提示都用新名字；对方给他的 AI 起了名字，聊天里写「林一的 小满」。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import { renderApp, settle } from '../../helpers.tsx';

it('编辑主线（第13批设计稿）：头像、名字、Soul、模型；画风点「换画风」才出；改的一起存，栏目和输入框提示跟着变', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '编辑主线' }));
  const editor = screen.getByRole('dialog', { name: '编辑主线' });
  expect(within(editor).queryByLabelText('职责')).toBeNull();
  expect(within(editor).queryByLabelText('头像文字')).toBeNull();
  expect(within(editor).queryByRole('group', { name: '颜色' })).toBeNull();
  expect(within(editor).queryByRole('group', { name: '脸型' })).toBeNull();
  expect(within(editor).queryByRole('group', { name: '画风' })).toBeNull();
  fireEvent.change(within(editor).getByLabelText('名字'), { target: { value: '阿泥' } });
  fireEvent.click(within(editor).getByRole('button', { name: '换画风' }));
  const styles = within(editor).getByRole('group', { name: '画风' });
  expect(within(styles).getByRole('button', { name: '扁平' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(styles).getByRole('button', { name: '霓虹' }));
  const soul = within(editor).getByLabelText('Soul') as HTMLTextAreaElement;
  await waitFor(() => expect(soul.value).toContain('你不是聊天机器人'));
  expect(within(editor).getByText('还没有自己改过')).toBeTruthy();
  expect(within(editor).getByRole('button', { name: /^模型/ })).toBeTruthy();
  fireEvent.change(soul, { target: { value: `${soul.value}\n\n## 说话\n- 先说结论。` } });
  fireEvent.click(within(editor).getByRole('button', { name: '保存修改' }));
  await waitFor(() => expect(app.control.mates.main).toEqual({ name: '阿泥', variant: 'neon' }));
  await waitFor(() => expect(app.control.souls.textOf('main')).toContain('## 说话\n- 先说结论。'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑主线' })).toBeNull());
  expect(await screen.findByRole('link', { name: '阿泥 主线' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: '栏目' }).querySelector('[aria-label="阿泥"]')).not.toBeNull();
  const input = await screen.findByRole('textbox', { name: '问一句' }) as HTMLTextAreaElement;
  expect(input.placeholder).toBe('回复 阿泥');
});

it('编辑主线：夜里自己改过的能看改动、能撤回；你改着没存时撤回点不了', async () => {
  const app = await renderApp({ hash: '#/plasticine', setup: (fake) => {
    fake.control.souls.ensure('main');
    const before = fake.control.souls.textOf('main') ?? '';
    fake.control.souls.seedSelf('main', `${before}\n\n## 说话\n- 讲到数字带上单位。`, '加了一条说话的习惯：数字带单位。',
      new Date(Date.now() - 6 * 60 * 60 * 1000));
  } });
  fireEvent.click(await screen.findByRole('button', { name: '编辑主线' }));
  const editor = screen.getByRole('dialog', { name: '编辑主线' });
  expect(await within(editor).findByText('昨晚整理时自己改了 1 处')).toBeTruthy();
  fireEvent.click(within(editor).getByRole('button', { name: '看改动' }));
  const diff = await within(editor).findByRole('region', { name: '这一次的改动' });
  expect(within(diff).getByText('加了一条说话的习惯：数字带单位。')).toBeTruthy();
  expect(await within(diff).findByText('- 讲到数字带上单位。')).toBeTruthy();
  const soul = within(editor).getByLabelText('Soul') as HTMLTextAreaElement;
  const saved = soul.value;
  fireEvent.change(soul, { target: { value: `${saved}\n- 没存的一句` } });
  expect((within(editor).getByRole('button', { name: '撤回' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(soul, { target: { value: saved } });
  fireEvent.click(within(editor).getByRole('button', { name: '撤回' }));
  await waitFor(() => expect(soul.value).not.toContain('讲到数字带上单位'));
  expect(app.control.souls.textOf('main')).not.toContain('讲到数字带上单位');
  expect(within(editor).getByText('已撤回昨晚的改动')).toBeTruthy();
});

it('对方的 AI 有名字：@ 菜单和聊天里写「林一的 小满」', async () => {
  await renderApp({ hash: '#/messages/c_linyi', width: 1440, setup: (fake) => {
    const { contacts, m5b, network, visibility } = fake.control;
    seedContacts({ contacts, inbox: m5b.inbox, network, visibility }, new Date('2026-11-12T08:00:00Z'));
    const lin = contacts.people.get('c_linyi');
    if (lin !== undefined) lin.aiName = '小满';
  } });
  await settle();
  const log = await screen.findByRole('log', { name: '和林一的聊天记录' });
  expect(await within(log).findByRole('img', { name: '林一的 小满' })).toBeTruthy();
});
