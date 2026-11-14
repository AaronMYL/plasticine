// 第 12 批：主线的名字可以自己起（11-13 起头像是泥团加漩涡，编辑主线改名字和画风）；
// 改了以后栏目、主线那一行、输入框提示都用新名字；对方给他的 AI 起了名字，聊天里写「林一的 小满」。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import { renderApp, settle } from '../../helpers.tsx';

it('编辑主线：改名字和画风，没有头像字、颜色和脸型；栏目、主线、输入框提示跟着变', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '编辑主线' }));
  const editor = screen.getByRole('dialog', { name: '编辑主线' });
  expect(within(editor).queryByLabelText('职责')).toBeNull();
  fireEvent.change(within(editor).getByLabelText('名字'), { target: { value: '阿泥' } });
  expect(within(editor).queryByLabelText('头像文字')).toBeNull();
  expect(within(editor).queryByRole('group', { name: '颜色' })).toBeNull();
  expect(within(editor).queryByRole('group', { name: '脸型' })).toBeNull();
  const styles = await within(editor).findByRole('group', { name: '画风' });
  expect(within(styles).getByRole('button', { name: '扁平' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(styles).getByRole('button', { name: '霓虹' }));
  fireEvent.click(within(editor).getByRole('button', { name: '保存修改' }));
  await waitFor(() => expect(app.control.mates.main).toEqual({ name: '阿泥', variant: 'neon' }));
  expect(await screen.findByRole('link', { name: '阿泥 主线' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: '栏目' }).querySelector('[aria-label="阿泥"]')).not.toBeNull();
  const input = await screen.findByRole('textbox', { name: '问一句' }) as HTMLTextAreaElement;
  expect(input.placeholder).toBe('回复 阿泥');
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
