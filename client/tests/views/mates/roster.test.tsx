import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';
import { createRequestId } from '../../../src/api/request-id.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';

const make = (fake: FakeApi, name: string) => fake.api.mates.create({ requestId: createRequestId(), name,
  avatar: 'cat', hue: 'sky', role: '整理资料来源', soul: '', purpose: null });

it('desktop sidebar creates teammate and two-person group and opens each conversation', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '添加队友' }));
  const editor = screen.getByRole('dialog', { name: '创建队友' });
  fireEvent.change(within(editor).getByLabelText('名字'), { target: { value: '资料研究员' } });
  expect(within(editor).queryByLabelText('职责')).toBeNull();
  fireEvent.change(within(editor).getByLabelText('Soul'), { target: { value: '你是我的资料研究员：核对来源和整理资料。' } });
  const colors = within(editor).getByRole('radiogroup', { name: '颜色' });
  const picked = within(colors).getAllByRole('radio')[2]!;
  fireEvent.click(picked);
  expect(picked.getAttribute('aria-checked')).toBe('true');
  expect(within(editor).queryByRole('group', { name: '角色' })).toBeNull();
  fireEvent.click(within(within(editor).getByRole('group', { name: '头像' })).getByRole('button', { name: '角色' }));
  const picker = within(editor).getByRole('group', { name: '角色' });
  fireEvent.click(await within(picker).findByRole('button', { name: '狐狸' }));
  expect(within(picker).getByRole('button', { name: '狐狸' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(editor).getByRole('button', { name: '创建队友' }));
  await waitFor(async () => expect((await app.api.mates.list()).mates).toHaveLength(1));
  const first = (await app.api.mates.list()).mates[0]!;
  expect(first.hue).toBe('sky');
  expect(first.avatar).toBe('fox');
  expect(first.role).toBe('核对来源和整理资料');
  expect(app.control.souls.textOf(first.id)).toBe('你是我的资料研究员：核对来源和整理资料。');
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

it('Plasticine column keeps title Plasticine with Skills and Memory actions on the right', async () => {
  await renderApp({ hash: '#/plasticine', setup: (fake) => {
    fake.control.mates.main = { ...fake.control.mates.main, name: '卷毛' };
  } });
  const column = await screen.findByRole('complementary', { name: 'Plasticine' });
  const head = column.querySelector<HTMLElement>('.column-head');
  if (head === null) throw new Error('没有标题行');
  expect(within(head).getByRole('heading', { level: 2 }).textContent).toBe('Plasticine');
  expect(await within(column).findByRole('link', { name: '卷毛 主线' })).toBeTruthy();
  fireEvent.click(within(head).getByRole('link', { name: '记忆' }));
  await waitFor(() => expect(window.location.hash).toBe('#/memory'));
  expect(within(head).getByRole('link', { name: '记忆' }).getAttribute('aria-current')).toBe('page');
  expect(within(head).getByRole('link', { name: '技能' }).getAttribute('aria-current')).toBeNull();
  expect(column.querySelector('.column-foot')).toBeNull();
  expect(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: 'Plasticine' }))
    .toBeTruthy();
});

it('mobile Plasticine root opens main thread; roster opens teammate chat and returns to main', async () => {
  await renderApp({ width: 390, hash: '#/plasticine' });
  expect(await screen.findByRole('textbox', { name: '问一句' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '队友和群组' }));
  const roster = await screen.findByRole('dialog', { name: '队友和群组' });
  expect(within(roster).getByRole('link', { name: 'Plasticine 主线' })).toBeTruthy();
  expect(within(roster).getByRole('heading', { name: '队友' })).toBeTruthy();
});

it('mobile roster Memory entry opens directory and navigates back', async () => {
  await renderApp({ width: 390, hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '队友和群组' }));
  fireEvent.click(await screen.findByRole('link', { name: '记忆' }));
  expect(await screen.findByRole('heading', { name: '记忆' })).toBeTruthy();
  expect(screen.queryByText('记忆暂时不能在手机打开。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '回到上一层' }));
  expect(await screen.findByRole('textbox', { name: '问一句' })).toBeTruthy();
});

it('roster bottom shows only Memory; legacy Soul route opens rule migration', async () => {
  await renderApp({ width: 390, hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '队友和群组' }));
  expect(await screen.findByRole('link', { name: '记忆' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Soul' })).toBeNull();
  window.location.hash = '#/plasticine/soul';
  expect(await screen.findByRole('heading', { name: '规则搬家' })).toBeTruthy();
});

it('creating teammate closes form immediately so late receipt does not pull user from current page', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  const original = app.api.mates.create.bind(app.api.mates);
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(app.api.mates, 'create').mockImplementation(async (body) => {
    await waiting;
    return original(body);
  });
  fireEvent.click(await screen.findByRole('button', { name: '添加队友' }));
  const editor = screen.getByRole('dialog', { name: '创建队友' });
  fireEvent.change(within(editor).getByLabelText('名字'), { target: { value: '校稿队友' } });
  fireEvent.change(within(editor).getByLabelText('Soul'), { target: { value: '你是我的校稿队友：核对文字。' } });
  fireEvent.click(within(editor).getByRole('button', { name: '创建队友' }));
  fireEvent.click(within(editor).getByRole('button', { name: '关掉创建队友' }));
  act(() => { window.location.hash = '#/notes'; });
  await act(async () => { release?.(); });
  await waitFor(async () => expect((await app.api.mates.list()).mates).toHaveLength(1));
  expect(window.location.hash).toBe('#/notes');
});

it('roster second line shows current activity when teammate is busy and role when idle', async () => {
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

it('new teammate starter preset fills name, Soul opening, and avatar role while staying editable', async () => {
  await renderApp({ hash: '#/plasticine' });
  fireEvent.click(await screen.findByRole('button', { name: '添加队友' }));
  const editor = screen.getByRole('dialog', { name: '创建队友' });
  const presets = within(editor).getByRole('group', { name: '从一个现成的开始' });
  fireEvent.click(within(presets).getByRole('button', { name: '文字编辑' }));
  expect((within(editor).getByLabelText('名字') as HTMLInputElement).value).toBe('文字编辑');
  expect((within(editor).getByLabelText('Soul') as HTMLTextAreaElement).value).toMatch(/^你是我的文字编辑：改稿、润色/);
  fireEvent.click(within(within(editor).getByRole('group', { name: '头像' })).getByRole('button', { name: '角色' }));
  const picker = within(editor).getByRole('group', { name: '角色' });
  expect((await within(picker).findByRole('button', { name: '兔子' })).getAttribute('aria-pressed')).toBe('true');
  expect(within(editor).queryByLabelText('头像文字')).toBeNull();
  expect(within(presets).getByRole('button', { name: '文字编辑' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(within(editor).getByLabelText('名字'), { target: { value: '校对' } });
  expect(within(presets).getByRole('button', { name: '文字编辑' }).getAttribute('aria-pressed')).toBe('false');
});

it('editing existing teammate saves role, style, face, and color without sending Soul', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  let mate: Awaited<ReturnType<typeof make>> | undefined;
  await act(async () => { mate = await make(app, '求职顾问'); });
  fireEvent.click(await screen.findByRole('link', { name: /求职顾问/ }));
  fireEvent.click(await screen.findByRole('button', { name: '更多' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '编辑队友' }));
  const editor = await screen.findByRole('dialog', { name: '编辑队友' });
  const tabs = within(editor).getByRole('group', { name: '头像' });
  fireEvent.click(within(tabs).getByRole('button', { name: '角色' }));
  const characters = within(editor).getByRole('group', { name: '角色' });
  fireEvent.click(await within(characters).findByRole('button', { name: '丸子头' }));
  fireEvent.click(within(tabs).getByRole('button', { name: '画风' }));
  expect(within(editor).queryByRole('group', { name: '角色' })).toBeNull();
  fireEvent.click(within(within(editor).getByRole('group', { name: '画风' })).getByRole('button', { name: '折纸' }));
  fireEvent.click(within(tabs).getByRole('button', { name: '脸型' }));
  const faces = within(editor).getByRole('group', { name: '脸型' });
  expect(within(faces).getByRole('button', { name: '萌脸' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(faces).getByRole('button', { name: '眼镜脸' }));
  fireEvent.click(within(editor).getByRole('radio', { name: '玫红' }));
  fireEvent.click(within(editor).getByRole('button', { name: '保存修改' }));
  await waitFor(async () => expect(await app.api.mates.get(mate!.id)).toMatchObject({ avatar: 'topknot',
    hue: 'rose', variant: 'origami', face: 'specs', role: '整理资料来源' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑队友' })).toBeNull());
});

it('editing teammate Soul saves new copy, updates role from first paragraph, and sets model choice', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  let mate: Awaited<ReturnType<typeof make>> | undefined;
  await act(async () => { mate = await make(app, '求职顾问'); });
  fireEvent.click(await screen.findByRole('link', { name: /求职顾问/ }));
  fireEvent.click(await screen.findByRole('button', { name: '更多' }));
  expect(screen.queryByRole('menuitem', { name: '只对它的规则' })).toBeNull();
  fireEvent.click(await screen.findByRole('menuitem', { name: '编辑队友' }));
  const editor = await screen.findByRole('dialog', { name: '编辑队友' });
  const soul = within(editor).getByLabelText('Soul') as HTMLTextAreaElement;
  await waitFor(() => expect(soul.value).toBe('你是我的求职顾问：整理资料来源。'));
  expect(within(editor).getByText('还没有自己改过')).toBeTruthy();
  fireEvent.change(soul, { target: { value: '你是我的求职顾问：简历和投递。\n\n## 说话\n- 先给要改的那一句。' } });
  const model = within(editor).getByLabelText('模型') as HTMLSelectElement;
  expect(model.value).toBe('');
  expect([...model.options].map((option) => option.text)).not.toContain('和「主线」一样');
  fireEvent.change(model, { target: { value: 'translation' } });
  fireEvent.click(within(editor).getByRole('button', { name: '保存修改' }));
  await waitFor(async () => expect(await app.api.mates.get(mate!.id)).toMatchObject({ role: '简历和投递',
    purpose: 'translation' }));
  await waitFor(() => expect(app.control.souls.textOf(mate!.id)).toContain('- 先给要改的那一句。'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑队友' })).toBeNull());
});
