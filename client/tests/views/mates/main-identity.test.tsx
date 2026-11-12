// 第 12 批：主线的名字可以自己起。编辑主线和编辑队友同一个弹框（名字、头像字、颜色，没有职责）；
// 改了以后栏目、主线那一行、输入框提示都用新名字；对方给他的 AI 起了名字，聊天里写「林一的 小满」。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import { renderApp, settle } from '../../helpers.tsx';

it('编辑主线：改名、头像字；栏目、主线、输入框提示跟着变', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '编辑主线' }));
  const editor = screen.getByRole('dialog', { name: '编辑主线' });
  expect(within(editor).queryByLabelText('职责')).toBeNull();
  fireEvent.change(within(editor).getByLabelText('名字'), { target: { value: '阿泥' } });
  fireEvent.change(within(editor).getByLabelText('头像文字'), { target: { value: '泥' } });
  fireEvent.click(within(editor).getByRole('button', { name: '保存修改' }));
  await waitFor(() => expect(app.control.mates.main).toEqual({ name: '阿泥', avatar: '泥', hue: 'sky' }));
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
