import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';
import { createRequestId } from '../../../src/api/request-id.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';

const make = (fake: FakeApi, name: string) => fake.api.mates.create({ requestId: createRequestId(), name,
  avatar: '研', hue: 'sky', role: '整理资料来源', soul: '', purpose: null });

it('电脑侧栏创建队友、创建两人群组，并进入各自的对话', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '添加队友' }));
  const editor = screen.getByRole('dialog', { name: '创建队友' });
  fireEvent.change(within(editor).getByLabelText('名字'), { target: { value: '资料研究员' } });
  fireEvent.change(within(editor).getByLabelText('职责'), { target: { value: '核对来源和整理资料' } });
  fireEvent.click(within(editor).getByRole('button', { name: '创建队友' }));
  await waitFor(async () => expect((await app.api.mates.list()).mates).toHaveLength(1));
  const first = (await app.api.mates.list()).mates[0]!;
  await waitFor(() => expect(window.location.hash).toBe(`#/plasticine/mate/${first.id}`));
  await act(async () => { await make(app, '编辑队友'); });
  fireEvent.click(await screen.findByRole('button', { name: '创建队友群组' }));
  const group = screen.getByRole('dialog', { name: '创建群组' });
  fireEvent.change(within(group).getByLabelText('群组名字'), { target: { value: '资料小组' } });
  fireEvent.click(within(group).getByRole('checkbox', { name: '资料研究员' }));
  fireEvent.click(await within(group).findByRole('checkbox', { name: '编辑队友' }));
  fireEvent.click(within(group).getByRole('button', { name: '创建群组' }));
  expect(await screen.findByText('你和 2 位队友')).toBeTruthy();
  expect(window.location.hash).toMatch(/^#\/plasticine\/group\//);
});

it('手机Plasticine根页是主线、队友、群组名单，点主线才进入聊天', async () => {
  await renderApp({ width: 390, hash: '#/plasticine' });
  expect(await screen.findByRole('heading', { name: 'Plasticine' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: '问一句' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Plasticine 主线' }));
  expect(await screen.findByRole('textbox', { name: '问一句' })).toBeTruthy();
  expect(window.location.hash).toBe('#/plasticine/main');
  fireEvent.click(screen.getByRole('button', { name: '返回队友列表' }));
  expect(await screen.findByRole('heading', { name: 'Plasticine' })).toBeTruthy();
});

it('手机名单的记忆入口打开目录并能返回', async () => {
  await renderApp({ width: 390, hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('link', { name: '记忆' }));
  expect(await screen.findByRole('heading', { name: '记忆' })).toBeTruthy();
  expect(screen.queryByText('记忆暂时不能在手机打开。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '回到上一层' }));
  expect(await screen.findByRole('heading', { name: 'Plasticine' })).toBeTruthy();
});

it('Soul 入口打开主线与队友规则页', async () => {
  await renderApp({ width: 390, hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('link', { name: 'Soul' }));
  expect(await screen.findByRole('heading', { name: '主线的 Soul' })).toBeTruthy();
  expect(window.location.hash).toBe('#/plasticine/soul');
  expect(screen.getByRole('button', { name: '返回队友列表' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: '问一句' })).toBeNull();
});
