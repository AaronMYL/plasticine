import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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
  const colors = within(editor).getByRole('radiogroup', { name: '颜色' });
  const picked = within(colors).getAllByRole('radio')[2]!;
  fireEvent.click(picked);
  expect(picked.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(within(editor).getByRole('button', { name: '创建队友' }));
  await waitFor(async () => expect((await app.api.mates.list()).mates).toHaveLength(1));
  const first = (await app.api.mates.list()).mates[0]!;
  expect(first.hue).toBe('sky');
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

it('手机 Plasticine 根页直接是主线；「队友和群组」打开名单，点队友进它的对话，返回回到主线', async () => {
  await renderApp({ width: 390, hash: '#/plasticine' });
  expect(await screen.findByRole('textbox', { name: '问一句' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '队友和群组' }));
  const roster = await screen.findByRole('dialog', { name: '队友和群组' });
  expect(within(roster).getByRole('link', { name: 'Plasticine 主线' })).toBeTruthy();
  expect(within(roster).getByRole('heading', { name: '队友' })).toBeTruthy();
});

it('手机名单的记忆入口打开目录并能返回', async () => {
  await renderApp({ width: 390, hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '队友和群组' }));
  fireEvent.click(await screen.findByRole('link', { name: '记忆' }));
  expect(await screen.findByRole('heading', { name: '记忆' })).toBeTruthy();
  expect(screen.queryByText('记忆暂时不能在手机打开。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '回到上一层' }));
  expect(await screen.findByRole('textbox', { name: '问一句' })).toBeTruthy();
});

it('Soul 并进记忆的「规则」（11-11）：名单底下只有「记忆」；旧地址打开规则', async () => {
  await renderApp({ width: 390, hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '队友和群组' }));
  expect(await screen.findByRole('link', { name: '记忆' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Soul' })).toBeNull();
  window.location.hash = '#/plasticine/soul';
  expect(await screen.findByRole('heading', { name: '规则' })).toBeTruthy();
});

it('创建队友发出后关闭表单，晚到回执不会把用户从当前页面拉走', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  const original = app.api.mates.create.bind(app.api.mates);
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(app.api.mates, 'create').mockImplementation(async (body) => { await waiting; return original(body); });
  fireEvent.click(await screen.findByRole('button', { name: '添加队友' }));
  const editor = screen.getByRole('dialog', { name: '创建队友' });
  fireEvent.change(within(editor).getByLabelText('名字'), { target: { value: '校稿队友' } });
  fireEvent.change(within(editor).getByLabelText('职责'), { target: { value: '核对文字' } });
  fireEvent.click(within(editor).getByRole('button', { name: '创建队友' }));
  fireEvent.click(within(editor).getByRole('button', { name: '关掉创建队友' }));
  act(() => { window.location.hash = '#/notes'; });
  await act(async () => { release?.(); });
  await waitFor(async () => expect((await app.api.mates.list()).mates).toHaveLength(1));
  expect(window.location.hash).toBe('#/notes');
});

it('队友正在做事时，名单第二行写在做什么；空着时写职责（11-12）', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  let mate: Awaited<ReturnType<typeof make>> | undefined;
  await act(async () => { mate = await make(app, '资料研究员'); });
  const row = await screen.findByRole('link', { name: /资料研究员/ });
  expect(row.textContent).toContain('整理资料来源');
  act(() => {
    const { lines } = app.control;
    lines.put(lines.blank('line-mate-work', 'background', '查三家中继的价格', { mateId: mate!.id, status: 'running' }));
  });
  await waitFor(() => expect(screen.getByRole('link', { name: /资料研究员/ }).textContent)
    .toContain('在做「查三家中继的价格」'));
});

it('新建队友时点一个现成的起点：名字、职责、头像字都填好，还能再改（11-12）', async () => {
  await renderApp({ hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '添加队友' }));
  const editor = screen.getByRole('dialog', { name: '创建队友' });
  const presets = within(editor).getByRole('group', { name: '从一个现成的开始' });
  fireEvent.click(within(presets).getByRole('button', { name: '文字编辑' }));
  expect((within(editor).getByLabelText('名字') as HTMLInputElement).value).toBe('文字编辑');
  expect((within(editor).getByLabelText('职责') as HTMLTextAreaElement).value).toMatch(/^改稿、润色/);
  expect((within(editor).getByLabelText('头像文字') as HTMLInputElement).value).toBe('编');
  expect(within(presets).getByRole('button', { name: '文字编辑' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(within(editor).getByLabelText('名字'), { target: { value: '校对' } });
  expect(within(presets).getByRole('button', { name: '文字编辑' }).getAttribute('aria-pressed')).toBe('false');
});
